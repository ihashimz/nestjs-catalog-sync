# Catalog Sync

A focused NestJS reference application for supplier catalog ingestion. It separates an authenticated API from queue workers, uses PostgreSQL transactions for import safety, and keeps file processing bounded as catalogs grow. All fixtures are synthetic. This is an original portfolio project; it is not a claim of production deployment or measured production traffic.

## Features

- NestJS 11, strict TypeScript, PostgreSQL and TypeORM with explicit migrations; `synchronize` is always disabled.
- JWT/Passport authentication, database-backed roles, validated DTOs and optional Swagger documentation.
- Products, deterministic variation identities and integer stock; prices stay decimal strings.
- Persistent imports of up to 10,000 batches with at most 100 products per batch, allowing up to one million products in a run without loading the catalog into memory.
- Streaming CSV CLI with quoted-field support, bounded record/body sizes, two validation passes, file-change detection and idempotent staging.
- BullMQ/Redis processing, exponential retries, durable retry counters and PostgreSQL dispatch reconciliation.
- Successful-snapshot deletion, supplier tombstones, source overlap protection and observable failure state.
- One shared supplier job scheduler at **00:00 UTC**, bounded HTTPS responses and request timeouts.
- Cache-aside reads with a fixed 30-second TTL, structured request logs and separate health/readiness probes.
- Non-root containers, Compose, Kustomize, network policies, resource limits, disruption budgets and an optional API HPA.

## Architecture

```mermaid
flowchart LR
  Client[Manager / viewer] --> API[NestJS API]
  CSV[Streaming CSV CLI] --> API
  API --> PG[(PostgreSQL)]
  API --> Redis[(Redis cache)]
  PG --> Dispatch[Worker dispatch reconciler]
  Dispatch --> Queue[BullMQ]
  Queue --> Worker[Import worker]
  Worker --> PG
  Scheduler[Midnight UTC scheduler] --> Supplier[Supplier worker]
  Supplier --> HTTPS[Configured supplier API]
  Supplier --> PG
```

Feature modules own their HTTP contracts and application services. Controllers perform transport work; `product-policy.ts` contains normalization and validation; `ImportRunner` handles the resumable loop; `PostgresImportStore` owns transaction and locking rules. Authentication uses TypeORM repositories. Import and read paths use parameterized SQL through TypeORM where joins, upserts and row locks are clearer than ORM object graphs. There is no generic repository framework.

## Data model and invariants

| Record                           | Responsibility                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `users`                          | Seeded viewer/manager roles and salted scrypt password hashes                                        |
| `sources`                        | One active run per supplier source                                                                   |
| `imports`                        | Immutable identity/metadata, lifecycle, expected/processed batches, attempt count and failure        |
| `import_batches`, `import_items` | Durable payloads, content hashes, progress and unique product IDs within a run                       |
| `products`                       | Unique `(source, external_id)`, numeric price, last successful batch observation and deletion reason |
| `variations`, `stock`            | Canonical attributes, unique SKU/identity per product and non-negative quantity                      |

A price has two decimal places and at most ten integer digits. Every product has 1–20 variations, each with 1–8 bounded attributes. Attribute key order cannot create a second variation identity. Duplicate product IDs across batches and duplicate variation IDs/SKUs are rejected. A full snapshot cannot be empty: accidental empty supplier responses never wipe a catalog. `deleted: true` is an explicit supplier tombstone with reason `supplier_flagged_deleted`; an absent product is deleted only after successful snapshot finalization with reason `missing_from_successful_snapshot`.

## Import lifecycle and transaction boundaries

1. Create a `staging` run. A source row lock serializes creation; another active run returns 409. Reusing a source/idempotency key returns the existing run, while changed metadata returns 409.
2. Stage numbered batches. Each transaction locks the source then the import. The batch hash makes identical retries safe; changed content or a repeated product identifier returns 409. Requests are capped at 512 KiB.
3. Seal only when every declared batch exists. PostgreSQL stores the `queued` dispatch intent; a worker reconciles it into Redis every 15 seconds, covering a crash or Redis outage between sealing and delivery. Reconciliation retries retained failed/completed queue jobs for still-active database runs; the persistent database attempt budget prevents unbounded import retries.
4. Process one bounded batch at a time. Product upserts, variation/stock replacement and the batch progress marker commit together. A retry skips committed batches. Different sources can run concurrently; the source lock protects an overlapping/stale snapshot.
5. Finalize under the same source/import lock. Expected batches and committed progress must agree before deleting unseen products, marking success and releasing the source. Those changes are one transaction.

A failed batch rolls back. Earlier committed upserts remain visible; this is a resumable import, not whole-catalog atomic replacement. A failure never performs snapshot deletion. Three persistent processing attempts exhaust the import budget, persist `failed` and release the source. Queue jobs also use three attempts with exponential backoff. Staging runs hold their source until sealed or explicitly aborted; operators should inspect failed supplier fetches and abort abandoned staging runs. Automatic pruning/expiry is intentionally omitted so an incomplete snapshot cannot silently take ownership again.

Reads may return cached data for up to 30 seconds after writes. Cache failures fall back to PostgreSQL. Readiness requires both PostgreSQL (including the import table) and Redis; liveness does not depend on either service. HTTP logs include a generated request ID, route template, method, final status and duration, without credentials or request bodies.

## API

| Method | Route                                | Access         | Behavior                                           |
| ------ | ------------------------------------ | -------------- | -------------------------------------------------- |
| POST   | `/auth/login`                        | Public         | Credentials → 15-minute bearer token               |
| GET    | `/auth/profile`                      | Authenticated  | Current database identity/role                     |
| GET    | `/products?source=…&page=1&limit=20` | Viewer/manager | Live products, variations and stock; limit ≤100    |
| POST   | `/imports`                           | Manager        | Create/idempotently retrieve a staged run          |
| PUT    | `/imports/:id/batches/:ordinal`      | Manager        | Stage 1–100 products                               |
| POST   | `/imports/:id/seal`                  | Manager        | Seal complete staging; dispatch asynchronously     |
| GET    | `/imports/:id`                       | Manager        | Persistent status, counters and safe error summary |
| DELETE | `/imports/:id`                       | Manager        | Abort a staging run                                |
| GET    | `/health/live`, `/health/ready`      | Public         | Liveness/readiness                                 |
| GET    | `/docs`                              | When enabled   | Swagger UI                                         |

No public registration grants roles. Passwords are never returned. JWT signature/expiry/issuer/audience are checked, and the current role is read from PostgreSQL on every authenticated request. The global Nest throttler allows 600 requests/minute per API process/IP, with a 5/minute login override. Probes skip throttling. This in-memory limit is per replica; put a shared rate limit at the ingress when scaling a public service. Swagger defaults off unless `SWAGGER_ENABLED=true`; secure or disable it outside development.

## Quick start

Prerequisites: Node.js 22, npm, and PostgreSQL/Redis (or Docker Compose). Copy the example configuration and replace every placeholder with local values. Use a URL-safe generated PostgreSQL password, because Compose interpolates it into a connection URL.

```bash
cp .env.example .env
# Edit .env: POSTGRES_PASSWORD, DATABASE_URL and JWT_SECRET.
# Generate local values with: openssl rand -hex 32
npm ci --ignore-scripts
npm run migration:run
SEED_PASSWORD='your-local-password-at-least-12-characters' npm run seed
npm run start:dev
# In another terminal, after npm run build:
npm run start:worker
```

Seed command reads `SEED_EMAIL`, `SEED_ROLE` (viewer or manager) and `SEED_PASSWORD` from your environment. It is an explicit development operation; there are no committed user passwords. Seed another viewer with a different email to exercise role restrictions.

Compose runs PostgreSQL, Redis, one migration job, API and worker:

```bash
docker compose up --build -d
# Seed in the runtime image, supplying your own local password:
docker compose exec -e SEED_PASSWORD='your-local-password-at-least-12-characters' api node dist/database/seed.js
```

The API binds to localhost port 3000. Compose data lives in named volumes. `docker compose down` preserves it; removing volumes is destructive. The dev Kubernetes dependencies below are deliberately ephemeral and do not provide backups or high availability.

### Import the synthetic JSON fixture

Login with the seeded identity, then use the returned token:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"manager@example.test","password":"your-local-password-at-least-12-characters"}'

# Export TOKEN locally from the login response.
curl -X POST http://localhost:3000/imports \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"source":"synthetic-supplier","mode":"snapshot","idempotencyKey":"fixture-v1","expectedBatches":1}'

# Export RUN_ID locally from the create response.
curl -X PUT "http://localhost:3000/imports/$RUN_ID/batches/0" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data-binary @fixtures/batch.json
curl -X POST "http://localhost:3000/imports/$RUN_ID/seal" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:3000/imports/$RUN_ID" -H "Authorization: Bearer $TOKEN"
```

### Stream a CSV

CSV columns are `externalId,name,price,deleted,variations`. `variations` is a quoted JSON array; `deleted` is `true` or `false`. See `fixtures/products.csv`. The CLI reads the file twice, validates every row, computes identical normalized hashes, stages only bounded batches and seals only after a complete unchanged second pass. A malformed/changed file or request failure leaves the run unsealed. Retrying the same file/source/key safely reuses matching staged batches.

```bash
export CATALOG_API_URL=http://localhost:3000
export CATALOG_TOKEN="$TOKEN"
npm run import:csv -- fixtures/products.csv synthetic-csv csv-fixture-v1
```

For long imports, supply `CATALOG_EMAIL` and `CATALOG_PASSWORD` in your local environment instead of a fixed token; the CLI logs in and renews once after a 401. It paces staging below the API throttle. The one-million-product limit is a capacity bound, not a throughput benchmark. The implementation uses individual parameterized product/variation writes inside each batch transaction; it does not claim a bulk single-query upsert.

## Configured supplier synchronization

Set `SUPPLIER_URL` to an operator-controlled HTTPS endpoint and optionally `SUPPLIER_TOKEN`; clients cannot choose a fetch URL. `SUPPLIER_SOURCE` defaults to `configured-supplier`. Every worker registers the same BullMQ scheduler ID at midnight UTC. A day's key is based on the scheduled timestamp and remains stable across retries. Fetches have a 10-second timeout, reject redirects, and read at most 512 KiB per response. The supplier queue retries at most three times.

The endpoint must return `{ "totalPages": 2, "products": [...] }` for `?page=1`, then the same declared page count for subsequent numbered pages. Every page contains 1–100 validated products; the maximum is 10,000 pages. Pagination must represent an immutable supplier snapshot for that run; a stable page count alone cannot prove upstream consistency. Exhausted fetch retries leave any staged run unsealed and visible for operator inspection/abort. No notification/email integration is simulated.

## Kubernetes

`k8s/base` contains API/worker Deployments, a versioned migration Job, Service, tokenless service account, default-deny networking, probes, resources and PDBs. The `dev` overlay adds a namespace, ConfigMap and **ephemeral** PostgreSQL/Redis. There is no committed Secret.

Create `k8s/overlays/dev/secrets.env` locally (ignored by Git) with your own values:

```dotenv
POSTGRES_PASSWORD=your-url-safe-local-value
DATABASE_URL=postgresql://catalog:your-url-safe-local-value@catalog-postgres:5432/catalog
JWT_SECRET=your-generated-secret-with-at-least-32-characters
```

Render and review before applying:

```bash
kubectl kustomize k8s/overlays/dev > /tmp/catalog-dev.yaml
# Rendered YAML includes your Secret. Keep it private; never commit it.
kubectl apply -k k8s/overlays/dev
kubectl -n catalog-dev wait --for=condition=complete job/catalog-migrate-v1 --timeout=300s
kubectl -n catalog-dev rollout status deployment/catalog-api
kubectl -n catalog-dev port-forward service/catalog-api 3000:3000
# Optional: metrics-server must be installed.
kubectl apply -f k8s/optional/hpa.yaml
```

Wait for the migration before serving traffic; readiness remains false if its schema is missing. Rename the migration Job for later migrations because Job templates are immutable. Change the image tag to the verified Git SHA/digest before deployment. GitHub Actions publishes GHCR images only after checks pass; ensure the GHCR package is public for anonymous pulls, or configure an `imagePullSecret`.

API/worker containers run as UID 1000, drop capabilities, disallow privilege escalation and use a read-only filesystem. The runtime service account has no API token or RBAC grants. Database/Redis dev images retain their upstream initialization behavior; harden or replace them with managed durable services for a real environment. NetworkPolicy requires a supporting CNI. The ingress example trusts the `ingress-nginx` namespace; customize it for your ingress. Supplier egress permits public IPv4 HTTPS; narrow it to operator-approved CIDRs/egress proxies. External database/Redis services require corresponding egress changes. PDBs keep one API/worker available during voluntary disruption; two replicas permit rolling maintenance. HPA requires metrics-server; CPU scaling is an example, not queue-depth autoscaling.

## Tests and verification

```bash
npm run format:check
npm run typecheck
npm run build
npm test
# Use a dedicated disposable database: the integration suite truncates its tables.
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/catalog_test npm test
npm audit --omit=dev
```

Unit/HTTP tests cover prices, stock, variation duplicates, tombstones, bounded CSV/supplier parsing, failure propagation, retry resumption, password hashing, real JWT HTTP rejection, role restrictions and the login throttle. PostgreSQL integration tests cover concurrent source claims, metadata/batch idempotency, incomplete seals, committed-batch retries, safe finalization, terminal failure and supplier tombstones. CI runs them with PostgreSQL 17, then builds and publishes an image to GHCR. Integration tests are skipped without `TEST_DATABASE_URL` and must never target a real catalog database.

Local verification and its limits are recorded in [docs/verification.md](docs/verification.md). There is no local Docker image/cluster deployment claim, load-test result, live supplier test, or Kubernetes server-side validation claim. PostgreSQL and Redis need durable storage/backups, retained import rows need a retention policy, the shared Redis should be separated for queue/cache pressure at larger scale, and supplier snapshots need an upstream consistency contract.

See [the design notes](docs/design.md) and [server-side Next.js integration](docs/nextjs-integration.md).
