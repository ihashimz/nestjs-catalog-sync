import { HttpException, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHash } from 'node:crypto';

export interface FailureDiagnostic {
  kind: 'database' | 'network' | 'timeout' | 'http' | 'validation' | 'internal';
  code: string;
  httpStatus?: number;
}
export type SupplierFailureCode =
  'HTTP_RESPONSE' | 'INVALID_PAYLOAD' | 'BODY_LIMIT' | 'SNAPSHOT_CHANGED';
export class SupplierFailure extends Error {
  constructor(
    public readonly code: SupplierFailureCode,
    public readonly httpStatus?: number,
  ) {
    // Only fixed application text enters BullMQ failedReason, even for supplier parse errors.
    super(
      code === 'BODY_LIMIT' ? 'Supplier response exceeds 512 KiB' : `Supplier failure: ${code}`,
    );
  }
}
const networkCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);
const sqlStateClasses = new Set([
  '00',
  '01',
  '02',
  '03',
  '08',
  '09',
  '0A',
  '0B',
  '0F',
  '0L',
  '0P',
  '0Z',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '2B',
  '2D',
  '2F',
  '34',
  '38',
  '39',
  '3B',
  '3D',
  '3F',
  '40',
  '42',
  '44',
  '53',
  '54',
  '55',
  '57',
  '58',
  '72',
  'F0',
  'HV',
  'P0',
  'XX',
]);
function property(value: unknown, key: string): unknown {
  try {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
}
function safeStatus(status: unknown): { httpStatus?: number } {
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? { httpStatus: status }
    : {};
}
export function classifyFailure(error: unknown): FailureDiagnostic {
  if (error instanceof SupplierFailure) {
    if (error.code === 'HTTP_RESPONSE')
      return { kind: 'http', code: 'HTTP_RESPONSE', ...safeStatus(error.httpStatus) };
    if (['INVALID_PAYLOAD', 'BODY_LIMIT', 'SNAPSHOT_CHANGED'].includes(error.code))
      return { kind: 'validation', code: error.code };
  }
  const code = property(property(error, 'driverError'), 'code') ?? property(error, 'code');
  if (
    typeof code === 'string' &&
    /^[A-Z0-9]{5}$/.test(code) &&
    sqlStateClasses.has(code.slice(0, 2))
  )
    return { kind: 'database', code };
  const name = property(error, 'name');
  if (name === 'TimeoutError') return { kind: 'timeout', code: 'REQUEST_TIMEOUT' };
  if (name === 'AbortError') return { kind: 'timeout', code: 'REQUEST_ABORTED' };
  const networkCode = property(property(error, 'cause'), 'code') ?? code;
  if (typeof networkCode === 'string' && networkCodes.has(networkCode))
    return { kind: 'network', code: networkCode };
  if (error instanceof HttpException)
    return { kind: 'http', code: 'HTTP_EXCEPTION', ...safeStatus(error.getStatus()) };
  if (error instanceof SyntaxError) return { kind: 'validation', code: 'INVALID_JSON' };
  return { kind: 'internal', code: 'UNCLASSIFIED' };
}
function jobIdentity(job: Job | undefined): { jobId?: string; runId?: string } {
  if (!job) return {};
  const id = String(job.id ?? '').slice(0, 128);
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  const safeId = uuid.test(id) || /^repeat:supplier-midnight-utc:\d{13}$/.test(id);
  return {
    jobId: safeId ? id : `sha256:${createHash('sha256').update(id).digest('hex').slice(0, 16)}`,
    ...(typeof job.data?.runId === 'string' && uuid.test(job.data.runId)
      ? { runId: job.data.runId }
      : {}),
  };
}
export function logWorkerFailure(
  logger: Logger,
  queue: string,
  event: string,
  error: unknown,
  job?: Job,
): void {
  logger.error(
    JSON.stringify({
      queue,
      event,
      ...jobIdentity(job),
      ...(job &&
      Number.isInteger(job.attemptsMade) &&
      job.attemptsMade >= 0 &&
      job.attemptsMade <= 10000
        ? { attempt: job.attemptsMade + (event === 'failed_attempt' ? 1 : 0) }
        : {}),
      failure: classifyFailure(error),
    }),
  );
}
