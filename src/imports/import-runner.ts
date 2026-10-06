export interface ImportStore {
  nextBatch(runId: string): Promise<number | null>;
  applyBatch(runId: string, ordinal: number): Promise<void>;
  finalize(runId: string): Promise<void>;
}
export class ImportRunner {
  constructor(private readonly store: ImportStore) {}
  async run(runId: string): Promise<void> {
    let ordinal = await this.store.nextBatch(runId);
    while (ordinal !== null) {
      await this.store.applyBatch(runId, ordinal);
      ordinal = await this.store.nextBatch(runId);
    }
    await this.store.finalize(runId);
  }
}
