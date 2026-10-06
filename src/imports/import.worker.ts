import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost, InjectQueue, OnWorkerEvent } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { Job, Queue } from 'bullmq';
import { ImportRunner } from './import-runner';
import { PostgresImportStore } from './postgres-import.store';
import { ImportDispatch } from './imports.module';
import { logWorkerFailure } from '../common/failure';
import { SupplierService } from '../supplier/supplier.service';
@Processor('catalog-imports', { concurrency: 2 })
export class ImportWorker extends WorkerHost {
  private readonly logger = new Logger('ImportWorker');
  constructor(private readonly store: PostgresImportStore) {
    super();
  }
  @OnWorkerEvent('failed')
  onFailed(job: Job<{ runId: string }> | undefined, error: Error): void {
    logWorkerFailure(this.logger, 'catalog-imports', 'job_failed', error, job);
  }
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logWorkerFailure(this.logger, 'catalog-imports', 'worker_error', error);
  }
  async process(job: Job<{ runId: string }>): Promise<void> {
    const run = await this.store.get(job.data.runId);
    if (['succeeded', 'failed', 'aborted'].includes(run.status)) return;
    if (!(await this.store.beginAttempt(run.id))) return;
    try {
      await new ImportRunner(this.store).run(run.id);
      this.logger.log(JSON.stringify({ runId: run.id, status: 'succeeded' }));
    } catch (error) {
      logWorkerFailure(this.logger, 'catalog-imports', 'failed_attempt', error, job);
      try {
        await this.store.recordFailure(run.id, error);
      } catch (persistenceError) {
        logWorkerFailure(
          this.logger,
          'catalog-imports',
          'failure_recording_failed',
          persistenceError,
          job,
        );
      }
      throw error;
    }
  }
}
@Processor('supplier-sync', { concurrency: 1 })
export class SupplierWorker extends WorkerHost {
  private readonly logger = new Logger('SupplierWorker');
  constructor(private readonly supplier: SupplierService) {
    super();
  }
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    logWorkerFailure(this.logger, 'supplier-sync', 'job_failed', error, job);
  }
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logWorkerFailure(this.logger, 'supplier-sync', 'worker_error', error);
  }
  async process(job: Job): Promise<void> {
    const day = new Date(job.opts.prevMillis ?? job.timestamp).toISOString().slice(0, 10);
    await this.supplier.sync(day);
  }
}
@Injectable()
export class WorkerSchedules implements OnModuleInit {
  private running = false;
  private readonly logger = new Logger('Dispatch');
  constructor(
    private readonly dispatch: ImportDispatch,
    @InjectQueue('supplier-sync') private readonly supplierQueue: Queue,
  ) {}
  async onModuleInit(): Promise<void> {
    if (process.env.SUPPLIER_URL)
      await this.supplierQueue.upsertJobScheduler(
        'supplier-midnight-utc',
        { pattern: '0 0 * * *', tz: 'UTC' },
        {
          name: 'supplier-sync',
          data: {},
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 86400, count: 100 },
            removeOnFail: { age: 604800, count: 100 },
          },
        },
      );
    else await this.supplierQueue.removeJobScheduler('supplier-midnight-utc');
    await this.tick();
  }
  @Interval(15000) async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatch.reconcile();
    } catch (error) {
      logWorkerFailure(this.logger, 'catalog-imports', 'reconciliation_failed', error);
    } finally {
      this.running = false;
    }
  }
}
