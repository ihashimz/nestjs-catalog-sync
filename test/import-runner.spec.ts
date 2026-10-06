import { ImportRunner, ImportStore } from '../src/imports/import-runner';
class MemoryStore implements ImportStore {
  completed = new Set<number>();
  deleted = false;
  finalized = false;
  failing = false;
  async nextBatch() {
    return [0, 1].find((id) => !this.completed.has(id)) ?? null;
  }
  async applyBatch(_runId: string, id: number) {
    if (this.failing && id === 1) throw new Error('database unavailable');
    this.completed.add(id);
  }
  async finalize() {
    if (this.completed.size !== 2) throw new Error('incomplete');
    this.deleted = true;
    this.finalized = true;
  }
}
describe('durable import runner', () => {
  it('resumes committed batches on retry and finalizes once complete', async () => {
    const store = new MemoryStore();
    store.failing = true;
    const runner = new ImportRunner(store);
    await expect(runner.run('id')).rejects.toThrow('database unavailable');
    expect(store.completed.size).toBe(1);
    expect(store.deleted).toBe(false);
    store.failing = false;
    await runner.run('id');
    expect(store.completed.size).toBe(2);
    expect(store.finalized).toBe(true);
  });
  it('propagates failure and never finalizes an incomplete snapshot', async () => {
    const store = new MemoryStore();
    store.failing = true;
    await expect(new ImportRunner(store).run('id')).rejects.toThrow();
    expect(store.deleted).toBe(false);
  });
});
