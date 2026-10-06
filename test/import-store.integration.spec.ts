import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/data-source';
import { PostgresImportStore } from '../src/imports/postgres-import.store';
import { ImportRunner } from '../src/imports/import-runner';
import { ProductInput } from '../src/catalog/product-policy';
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const fixture = (externalId: string): ProductInput => ({
  externalId,
  name: `Synthetic ${externalId}`,
  price: '10.00',
  variations: [{ sku: `${externalId}-blue`, attributes: { color: 'blue' }, quantity: 2 }],
});
integration('PostgreSQL transaction and source invariants', () => {
  let db: DataSource;
  let store: PostgresImportStore;
  beforeAll(async () => {
    db = new DataSource({ ...databaseOptions(), url: process.env.TEST_DATABASE_URL });
    await db.initialize();
    await db.runMigrations();
    store = new PostgresImportStore(db);
  });
  afterAll(async () => {
    await db?.destroy();
  });
  beforeEach(async () => {
    await db.query(
      'UPDATE sources SET active_run_id=NULL; TRUNCATE stock,variations,products,import_items,import_batches,imports,sources CASCADE',
    );
  });
  const create = (key: string, mode: 'delta' | 'snapshot' = 'snapshot', expectedBatches = 1) =>
    store.create({ source: 'fixture-source', mode, idempotencyKey: key, expectedBatches });
  it('serializes simultaneous runs for the same source', async () => {
    const results = await Promise.allSettled([create('first'), create('second')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('returns the same idempotent run and rejects changed metadata', async () => {
    const first = await create('same');
    expect((await create('same')).id).toBe(first.id);
    await expect(create('same', 'delta')).rejects.toThrow('different metadata');
  });
  it('rejects changed batch content and cross-batch product duplicates', async () => {
    const run = await create('duplicates', 'snapshot', 2);
    await store.stage(run.id, 0, [fixture('one')]);
    await store.stage(run.id, 0, [fixture('one')]);
    await expect(store.stage(run.id, 0, [fixture('two')])).rejects.toThrow('different content');
    await expect(store.stage(run.id, 1, [fixture('one')])).rejects.toThrow('another batch');
  });
  it('does not seal or delete from an incomplete staged snapshot', async () => {
    const run = await create('incomplete', 'snapshot', 2);
    await store.stage(run.id, 0, [fixture('one')]);
    await expect(store.seal(run.id)).rejects.toThrow('All expected');
    await expect(store.finalize(run.id)).rejects.toThrow('Incomplete');
  });
  it('keeps missing products during partial processing and deletes only after successful finalization', async () => {
    const seed = await create('seed');
    await store.stage(seed.id, 0, [fixture('keep'), fixture('missing')]);
    await store.seal(seed.id);
    await store.beginAttempt(seed.id);
    await new ImportRunner(store).run(seed.id);
    const run = await create('partial', 'snapshot', 2);
    await store.stage(run.id, 0, [fixture('keep')]);
    await store.stage(run.id, 1, [fixture('new')]);
    await store.seal(run.id);
    await store.beginAttempt(run.id);
    await store.applyBatch(run.id, 0);
    await store.applyBatch(run.id, 0);
    expect((await store.get(run.id)).processed_batches).toBe(1);
    await expect(store.finalize(run.id)).rejects.toThrow('Incomplete');
    const before = await db.query("SELECT deleted_at FROM products WHERE external_id='missing'");
    expect(before[0].deleted_at).toBeNull();
    await new ImportRunner(store).run(run.id);
    await store.finalize(run.id);
    const after = await db.query(
      "SELECT deletion_reason FROM products WHERE external_id='missing'",
    );
    expect(after[0].deletion_reason).toBe('missing_from_successful_snapshot');
  });
  it('persists terminal failure and frees source ownership without deletion', async () => {
    const run = await create('fail');
    await store.stage(run.id, 0, [fixture('one')]);
    await store.seal(run.id);
    for (let i = 0; i < 3; i++) {
      await store.beginAttempt(run.id);
      await store.recordFailure(run.id);
    }
    expect((await store.get(run.id)).status).toBe('failed');
    expect((await create('next')).status).toBe('staging');
  });
  it('soft deletes an explicitly flagged supplier product even in a delta import', async () => {
    const run = await create('tombstone', 'delta');
    await store.stage(run.id, 0, [{ ...fixture('deleted'), deleted: true }]);
    await store.seal(run.id);
    await store.beginAttempt(run.id);
    await new ImportRunner(store).run(run.id);
    const rows = await db.query(
      "SELECT deleted_at, deletion_reason FROM products WHERE external_id='deleted'",
    );
    expect(rows[0].deleted_at).not.toBeNull();
    expect(rows[0].deletion_reason).toBe('supplier_flagged_deleted');
  });
});
