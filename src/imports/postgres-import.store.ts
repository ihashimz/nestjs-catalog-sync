import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import {
  mapProduct,
  ProductInput,
  snapshotCanDelete,
  variationIdentity,
} from '../catalog/product-policy';
import { CreateImportDto } from './import.dto';
import { classifyFailure } from '../common/failure';
import { ImportStore } from './import-runner';
export interface Run {
  id: string;
  source: string;
  mode: string;
  status: string;
  expected_batches: number;
  processed_batches: number;
  attempt_count: number;
  error: string | null;
}
@Injectable()
export class PostgresImportStore implements ImportStore {
  constructor(private readonly db: DataSource) {}
  async get(id: string): Promise<Run> {
    const rows: Run[] = await this.db.query('SELECT * FROM imports WHERE id=$1', [id]);
    if (!rows[0]) throw new NotFoundException('Import not found');
    return rows[0];
  }
  // Lock order is always source → import → batch; competing paths use the same order.
  private async locked(m: EntityManager, id: string): Promise<Run> {
    const rows: Run[] = await m.query('SELECT * FROM imports WHERE id=$1', [id]);
    if (!rows[0]) throw new NotFoundException('Import not found');
    const sources: { active_run_id: string | null }[] = await m.query(
      'SELECT active_run_id FROM sources WHERE id=$1 FOR UPDATE',
      [rows[0].source],
    );
    const runs: Run[] = await m.query('SELECT * FROM imports WHERE id=$1 FOR UPDATE', [id]);
    if (runs[0].status !== 'succeeded' && sources[0].active_run_id !== id)
      throw new ConflictException('Source is no longer owned by this import');
    return runs[0];
  }
  async create(dto: CreateImportDto): Promise<Run> {
    return this.db.transaction(async (m) => {
      await m.query('INSERT INTO sources(id) VALUES($1) ON CONFLICT DO NOTHING', [dto.source]);
      const sources: { active_run_id: string | null }[] = await m.query(
        'SELECT active_run_id FROM sources WHERE id=$1 FOR UPDATE',
        [dto.source],
      );
      const previous: Run[] = await m.query(
        'SELECT * FROM imports WHERE source=$1 AND idempotency_key=$2',
        [dto.source, dto.idempotencyKey],
      );
      if (previous[0]) {
        if (previous[0].mode !== dto.mode || previous[0].expected_batches !== dto.expectedBatches)
          throw new ConflictException('Idempotency key reused with different metadata');
        return previous[0];
      }
      if (sources[0].active_run_id)
        throw new ConflictException(
          'Source already has an active import; finish or abort its staging run',
        );
      const id = randomUUID();
      const runs: Run[] = await m.query(
        "INSERT INTO imports(id,source,idempotency_key,mode,status,expected_batches) VALUES($1,$2,$3,$4,'staging',$5) RETURNING *",
        [id, dto.source, dto.idempotencyKey, dto.mode, dto.expectedBatches],
      );
      await m.query('UPDATE sources SET active_run_id=$1 WHERE id=$2', [id, dto.source]);
      return runs[0];
    });
  }
  async stage(id: string, ordinal: number, inputs: ProductInput[]): Promise<void> {
    let products: ProductInput[];
    try {
      products = inputs.map(mapProduct);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Invalid products');
    }
    if (
      !Number.isInteger(ordinal) ||
      ordinal < 0 ||
      ordinal >= 10000 ||
      products.length < 1 ||
      products.length > 100
    )
      throw new BadRequestException('Batch bounds exceeded');
    if (new Set(products.map((p) => p.externalId)).size !== products.length)
      throw new BadRequestException('Duplicate product identifier');
    const payload = JSON.stringify(products);
    const hash = createHash('sha256').update(payload).digest('hex');
    await this.db.transaction(async (m) => {
      const run = await this.locked(m, id);
      if (ordinal >= run.expected_batches)
        throw new BadRequestException('Ordinal outside expected batches');
      const previous: { hash: string }[] = await m.query(
        'SELECT hash FROM import_batches WHERE run_id=$1 AND ordinal=$2',
        [id, ordinal],
      );
      if (previous[0]) {
        if (previous[0].hash !== hash)
          throw new ConflictException('Batch already staged with different content');
        return;
      }
      if (run.status !== 'staging') throw new ConflictException('Import is sealed');
      const duplicates: { external_id: string }[] = await m.query(
        'SELECT external_id FROM import_items WHERE run_id=$1 AND external_id=ANY($2::varchar[])',
        [id, products.map((p) => p.externalId)],
      );
      if (duplicates.length)
        throw new ConflictException('Product already appears in another batch');
      await m.query(
        'INSERT INTO import_batches(run_id,ordinal,payload,hash) VALUES($1,$2,$3::jsonb,$4)',
        [id, ordinal, payload, hash],
      );
      await m.query(
        'INSERT INTO import_items(run_id,external_id,ordinal) SELECT $1,unnest($2::varchar[]),$3',
        [id, products.map((p) => p.externalId), ordinal],
      );
    });
  }
  async seal(id: string): Promise<Run> {
    return this.db.transaction(async (m) => {
      const run = await this.locked(m, id);
      if (run.status !== 'staging') return run;
      const counts: { count: string }[] = await m.query(
        'SELECT count(*) FROM import_batches WHERE run_id=$1',
        [id],
      );
      if (Number(counts[0].count) !== run.expected_batches)
        throw new ConflictException('All expected batches must be staged before seal');
      const rows: Run[] = await m.query(
        "UPDATE imports SET status='queued',updated_at=now() WHERE id=$1 RETURNING *",
        [id],
      );
      return rows[0];
    });
  }
  async abort(id: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const run = await this.locked(m, id);
      if (run.status !== 'staging') throw new ConflictException('Only staging runs may be aborted');
      await m.query("UPDATE imports SET status='aborted',updated_at=now() WHERE id=$1", [id]);
      await m.query('UPDATE sources SET active_run_id=NULL WHERE id=$1', [run.source]);
    });
  }
  async beginAttempt(id: string): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const run = await this.locked(m, id);
      if (run.status === 'succeeded') return false;
      if (!['queued', 'processing', 'retrying'].includes(run.status))
        throw new ConflictException('Import cannot be processed');
      if (run.attempt_count >= 3) {
        await this.failWithin(m, run, true);
        return false;
      }
      await m.query(
        "UPDATE imports SET status='processing',attempt_count=attempt_count+1,updated_at=now() WHERE id=$1",
        [id],
      );
      return true;
    });
  }
  async nextBatch(id: string): Promise<number | null> {
    const rows: { ordinal: number }[] = await this.db.query(
      'SELECT ordinal FROM import_batches WHERE run_id=$1 AND processed=false ORDER BY ordinal LIMIT 1',
      [id],
    );
    return rows[0]?.ordinal ?? null;
  }
  async applyBatch(id: string, ordinal: number): Promise<void> {
    await this.db.transaction(async (m) => {
      const run = await this.locked(m, id);
      if (run.status === 'succeeded') return;
      if (run.status !== 'processing') throw new ConflictException('Import is not processing');
      const rows: { payload: ProductInput[]; processed: boolean }[] = await m.query(
        'SELECT payload,processed FROM import_batches WHERE run_id=$1 AND ordinal=$2 FOR UPDATE',
        [id, ordinal],
      );
      if (!rows[0]) throw new NotFoundException('Batch not found');
      if (rows[0].processed) return;
      for (const input of rows[0].payload) {
        const p = mapProduct(input);
        const products: { id: string }[] = await m.query(
          `INSERT INTO products (
            id, source, external_id, name, price, last_seen_run, deleted_at, deletion_reason
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            CASE WHEN $7 THEN now() ELSE NULL END,
            CASE WHEN $7 THEN 'supplier_flagged_deleted' ELSE NULL END
          )
          ON CONFLICT (source, external_id) DO UPDATE SET
            name = excluded.name,
            price = excluded.price,
            last_seen_run = excluded.last_seen_run,
            deleted_at = excluded.deleted_at,
            deletion_reason = excluded.deletion_reason
          RETURNING id`,
          [randomUUID(), run.source, p.externalId, p.name, p.price, id, p.deleted ?? false],
        );
        const productId = products[0].id;
        await m.query('DELETE FROM variations WHERE product_id=$1', [productId]);
        for (const v of p.variations) {
          const identity = variationIdentity(v.attributes);
          const hex = createHash('sha256')
            .update(productId + identity)
            .digest('hex')
            .slice(0, 32);
          const variationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
          await m.query(
            'INSERT INTO variations(id,product_id,sku,identity,attributes) VALUES($1,$2,$3,$4,$5::jsonb)',
            [variationId, productId, v.sku, identity, JSON.stringify(v.attributes)],
          );
          await m.query('INSERT INTO stock(variation_id,quantity) VALUES($1,$2)', [
            variationId,
            v.quantity,
          ]);
        }
      }
      await m.query('UPDATE import_batches SET processed=true WHERE run_id=$1 AND ordinal=$2', [
        id,
        ordinal,
      ]);
      await m.query(
        'UPDATE imports SET processed_batches=processed_batches+1,updated_at=now() WHERE id=$1',
        [id],
      );
    });
  }
  async finalize(id: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const run = await this.locked(m, id);
      if (run.status === 'succeeded') return;
      if (run.status !== 'processing' || run.expected_batches !== run.processed_batches)
        throw new ConflictException('Incomplete import cannot finalize');
      const counts: { count: string }[] = await m.query(
        'SELECT count(*) FROM import_batches WHERE run_id=$1 AND processed=true',
        [id],
      );
      if (Number(counts[0].count) !== run.expected_batches)
        throw new ConflictException('Incomplete batches');
      if (
        snapshotCanDelete({
          mode: run.mode,
          status: 'succeeded',
          expected: run.expected_batches,
          processed: run.processed_batches,
        })
      )
        await m.query(
          "UPDATE products SET deleted_at=now(),deletion_reason='missing_from_successful_snapshot' WHERE source=$1 AND last_seen_run<>$2 AND deleted_at IS NULL",
          [run.source, id],
        );
      await m.query(
        "UPDATE imports SET status='succeeded',error=NULL,updated_at=now() WHERE id=$1",
        [id],
      );
      await m.query('UPDATE sources SET active_run_id=NULL WHERE id=$1', [run.source]);
    });
  }
  private async failWithin(
    m: EntityManager,
    run: Run,
    terminal: boolean,
    error?: unknown,
  ): Promise<void> {
    await m.query('UPDATE imports SET status=$2,error=$3,updated_at=now() WHERE id=$1', [
      run.id,
      terminal ? 'failed' : 'retrying',
      error === undefined
        ? (run.error ?? JSON.stringify({ kind: 'internal', code: 'RETRY_BUDGET_EXHAUSTED' }))
        : JSON.stringify(classifyFailure(error)),
    ]);
    if (terminal)
      await m.query('UPDATE sources SET active_run_id=NULL WHERE id=$1 AND active_run_id=$2', [
        run.source,
        run.id,
      ]);
  }
  async recordFailure(id: string, error?: unknown): Promise<void> {
    await this.db.transaction(async (m) => {
      const run = await this.locked(m, id);
      if (run.status === 'succeeded') return;
      await this.failWithin(m, run, run.attempt_count >= 3, error);
    });
  }
  async dispatchable(): Promise<Run[]> {
    return this.db.query(
      "SELECT * FROM imports WHERE status IN ('queued','processing','retrying') ORDER BY created_at LIMIT 100",
    );
  }
}
