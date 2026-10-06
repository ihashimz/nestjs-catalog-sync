import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { classifyFailure, SupplierFailure } from '../src/common/failure';
import { ImportWorker, SupplierWorker } from '../src/imports/import.worker';
import { PostgresImportStore } from '../src/imports/postgres-import.store';
import { SupplierService } from '../src/supplier/supplier.service';
const secret = 'https://supplier.test?token=private-value password=private-value';
describe('safe worker failure diagnostics', () => {
  it('preserves PostgreSQL SQLSTATE without query text, parameters or stack', () => {
    const error = Object.assign(new Error(secret), {
      driverError: { code: '23505', detail: secret },
      query: secret,
      parameters: [secret],
    });
    expect(classifyFailure(error)).toEqual({ kind: 'database', code: '23505' });
    expect(JSON.stringify(classifyFailure(error))).not.toContain('private-value');
  });
  it('preserves only a safe supplier HTTP status', () => {
    expect(classifyFailure(new SupplierFailure('HTTP_RESPONSE', 503))).toEqual({
      kind: 'http',
      code: 'HTTP_RESPONSE',
      httpStatus: 503,
    });
    expect(classifyFailure(new SupplierFailure('HTTP_RESPONSE', -999))).toEqual({
      kind: 'http',
      code: 'HTTP_RESPONSE',
    });
  });
  it('identifies native timeouts and allowlisted network causes', () => {
    expect(classifyFailure(Object.assign(new Error(secret), { name: 'TimeoutError' }))).toEqual({
      kind: 'timeout',
      code: 'REQUEST_TIMEOUT',
    });
    expect(
      classifyFailure(new TypeError(secret, { cause: { code: 'ECONNREFUSED', message: secret } })),
    ).toEqual({ kind: 'network', code: 'ECONNREFUSED' });
  });
  it('classifies invalid supplier payloads and oversized responses', () => {
    expect(classifyFailure(new SupplierFailure('INVALID_PAYLOAD'))).toEqual({
      kind: 'validation',
      code: 'INVALID_PAYLOAD',
    });
    expect(classifyFailure(new SupplierFailure('BODY_LIMIT'))).toEqual({
      kind: 'validation',
      code: 'BODY_LIMIT',
    });
  });
  it('does not echo arbitrary error names, codes, messages or circular causes', () => {
    const error: Record<string, unknown> = {
      name: secret,
      code: secret,
      message: secret,
      stack: secret,
    };
    error.cause = error;
    expect(classifyFailure(error)).toEqual({ kind: 'internal', code: 'UNCLASSIFIED' });
    expect(classifyFailure({ code: 'TOKEN', message: secret })).toEqual({
      kind: 'internal',
      code: 'UNCLASSIFIED',
    });
    expect(JSON.stringify(classifyFailure(error)).length).toBeLessThan(100);
  });
  it('logs bounded import failed/error events without raw exception text', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const worker = new ImportWorker({} as PostgresImportStore);
      worker.onFailed(
        {
          id: 'e5f2a340-7254-4f71-9ecf-3a1164bf9a24',
          data: { runId: 'e5f2a340-7254-4f71-9ecf-3a1164bf9a24' },
          attemptsMade: 2,
        } as Job<{ runId: string }>,
        Object.assign(new Error(secret), { code: '40P01' }),
      );
      worker.onError(Object.assign(new Error(secret), { code: 'ECONNRESET' }));
      const output = log.mock.calls.map((call) => String(call[0])).join('\n');
      expect(output).toContain('40P01');
      expect(output).toContain('worker_error');
      expect(output).not.toContain('private-value');
    } finally {
      log.mockRestore();
    }
  });
  it('logs supplier failures and runtime errors with their classifications', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const worker = new SupplierWorker({} as SupplierService);
      worker.onFailed(
        { id: 'repeat:supplier-midnight-utc:1791244800000', attemptsMade: 3 } as Job,
        new SupplierFailure('HTTP_RESPONSE', 429),
      );
      worker.onError(Object.assign(new Error(secret), { name: 'TimeoutError' }));
      const events = log.mock.calls.map(
        (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
      );
      expect(events[0]).toMatchObject({
        queue: 'supplier-sync',
        event: 'job_failed',
        failure: { kind: 'http', code: 'HTTP_RESPONSE', httpStatus: 429 },
      });
      expect(events[1]).toMatchObject({
        event: 'worker_error',
        failure: { kind: 'timeout', code: 'REQUEST_TIMEOUT' },
      });
      expect(JSON.stringify(events)).not.toContain('private-value');
    } finally {
      log.mockRestore();
    }
  });
  it('stores the sanitized diagnostic instead of a generic instruction or raw SQL failure', async () => {
    let saved: unknown;
    const runId = 'e5f2a340-7254-4f71-9ecf-3a1164bf9a24';
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        if (sql.startsWith('SELECT * FROM imports'))
          return [
            { id: runId, source: 'fixture', status: 'processing', attempt_count: 1, error: null },
          ];
        if (sql.startsWith('SELECT active_run_id')) return [{ active_run_id: runId }];
        if (sql.startsWith('UPDATE imports')) saved = parameters[2];
        return [];
      },
    };
    const db = {
      transaction: async (operation: (m: typeof manager) => Promise<void>) => operation(manager),
    } as unknown as DataSource;
    await new PostgresImportStore(db).recordFailure(
      runId,
      Object.assign(new Error(secret), { code: '23505' }),
    );
    expect(JSON.parse(String(saved))).toEqual({ kind: 'database', code: '23505' });
    expect(String(saved)).not.toContain('private-value');
  });
  it('hashes unexpected job identities instead of logging a supplied URL or token', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      new SupplierWorker({} as SupplierService).onFailed(
        { id: secret, attemptsMade: 1 } as Job,
        new Error(secret),
      );
      const event = JSON.parse(String(log.mock.calls[0][0])) as { jobId: string };
      expect(event.jobId).toMatch(/^sha256:[a-f0-9]{16}$/);
      expect(JSON.stringify(event)).not.toContain('private-value');
    } finally {
      log.mockRestore();
    }
  });
});
