import { MigrationInterface, QueryRunner } from 'typeorm';
export class Initial1760000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE users (id uuid PRIMARY KEY,
         email varchar(254) UNIQUE NOT NULL,
         password_hash text NOT NULL,
         role text NOT NULL CHECK (role IN ('viewer','manager')));
      CREATE TABLE sources (id varchar(80) PRIMARY KEY,
         active_run_id uuid);
      CREATE TABLE imports (id uuid PRIMARY KEY,
         source varchar(80) NOT NULL REFERENCES sources(id),
         idempotency_key varchar(128) NOT NULL,
         mode text NOT NULL CHECK (mode IN ('delta','snapshot')),
         status text NOT NULL CHECK (status IN ('staging','queued','processing','retrying','succeeded','failed','aborted')),
         expected_batches integer NOT NULL CHECK (expected_batches BETWEEN 1 AND 10000),
         processed_batches integer NOT NULL DEFAULT 0,
         attempt_count integer NOT NULL DEFAULT 0,
         error text,
         created_at timestamptz NOT NULL DEFAULT now(),
         updated_at timestamptz NOT NULL DEFAULT now(),
         UNIQUE(source,idempotency_key));
      ALTER TABLE sources ADD CONSTRAINT active_run_fk FOREIGN KEY (active_run_id) REFERENCES imports(id);
      CREATE TABLE import_batches (run_id uuid REFERENCES imports(id) ON DELETE CASCADE,
         ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 9999),
         payload jsonb NOT NULL CHECK (jsonb_array_length(payload) BETWEEN 1 AND 100),
         hash text NOT NULL,
         processed boolean NOT NULL DEFAULT false,
         PRIMARY KEY(run_id,ordinal));
      CREATE TABLE import_items (run_id uuid REFERENCES imports(id) ON DELETE CASCADE,
         external_id varchar(120) NOT NULL,
         ordinal integer NOT NULL,
         PRIMARY KEY(run_id,external_id),
         FOREIGN KEY (run_id,ordinal) REFERENCES import_batches(run_id,ordinal) ON DELETE CASCADE);
      CREATE TABLE products (id uuid PRIMARY KEY,
         source varchar(80) NOT NULL REFERENCES sources(id),
         external_id varchar(120) NOT NULL,
         name varchar(240) NOT NULL,
         price numeric(12,2) NOT NULL CHECK (price >= 0),
         last_seen_run uuid NOT NULL REFERENCES imports(id),
         deleted_at timestamptz,
         deletion_reason text,
         UNIQUE(source,external_id));
      CREATE INDEX products_live_page ON products(source,
        id) WHERE deleted_at IS NULL;
      CREATE TABLE variations (id uuid PRIMARY KEY,
         product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
         sku varchar(120) NOT NULL,
         identity text NOT NULL,
         attributes jsonb NOT NULL,
         UNIQUE(product_id,identity),
         UNIQUE(product_id,sku));
      CREATE TABLE stock (variation_id uuid PRIMARY KEY REFERENCES variations(id) ON DELETE CASCADE,
         quantity integer NOT NULL CHECK (quantity >= 0));
      CREATE INDEX imports_dispatch ON imports(status,
        created_at);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE sources DROP CONSTRAINT active_run_fk; DROP TABLE stock, variations, products, import_items, import_batches, imports, sources, users;',
    );
  }
}
