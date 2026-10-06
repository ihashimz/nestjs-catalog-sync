import { ImportDispatch } from '../src/imports/imports.module';
import { PostgresImportStore, Run } from '../src/imports/postgres-import.store';
import { Job, Queue } from 'bullmq';
describe('durable dispatch reconciliation', () => {
  it('repairs a failed queue job while its database run is still dispatchable', async () => {
    const retry = jest.fn(async () => {});
    const failed = { getState: async () => 'failed', retry } as unknown as Job;
    const queue = { add: jest.fn(), getJob: async () => failed } as unknown as Queue;
    const store = {
      dispatchable: async () => [{ id: 'run', status: 'retrying', attempt_count: 1 }],
    } as unknown as PostgresImportStore;
    await new ImportDispatch(queue, store).reconcile();
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('does not restart terminal database failures', async () => {
    const queue = { add: jest.fn(), getJob: jest.fn() } as unknown as Queue;
    const store = { dispatchable: async () => [] as Run[] } as unknown as PostgresImportStore;
    await new ImportDispatch(queue, store).reconcile();
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.getJob).not.toHaveBeenCalled();
  });
  it('persists terminal failure instead of retrying an exhausted database run', async () => {
    const retry = jest.fn(async () => {});
    const queue = {
      add: jest.fn(),
      getJob: async () => ({ getState: async () => 'failed', retry }),
    } as unknown as Queue;
    const recordFailure = jest.fn(async () => {});
    const store = {
      dispatchable: async () => [{ id: 'run', status: 'processing', attempt_count: 3 }],
      recordFailure,
    } as unknown as PostgresImportStore;
    await new ImportDispatch(queue, store).reconcile();
    expect(recordFailure).toHaveBeenCalledWith('run');
    expect(retry).not.toHaveBeenCalled();
  });
});
