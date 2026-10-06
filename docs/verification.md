# Verification record

Recorded 2026-10-06 on Node.js 22.22.3. This records local checks, not a live deployment.

- Core mapping/snapshot/role tests, resumable-runner tests, password/role tests, supplier bounds, CSV parsing/tombstones and retained-job reconciliation regressions were written before their implementations and observed failing for the intended missing behavior.
- `npm run format:check`: passes.
- `npm run typecheck`: strict TypeScript passes.
- `npm run build`: compiles API, worker, migrations, seed and CSV CLI.
- `npm test`: 47 tests pass across eight local suites; seven PostgreSQL integration tests skip because `TEST_DATABASE_URL` is unset. HTTP tests exercise real Passport/JWT requests with an injected user repository, including 401, 403, login throttling and current-role lookup.
- `npm audit --json`: zero vulnerabilities across runtime and development dependencies at verification time. The lockfile includes Jest 30, a compatible YAML API override to the patched `js-yaml` 5 series, and `csv-parse` 7. Re-run audits as advisories change.
- `docker compose ... config -q`: parses the Compose configuration using a temporary copy of placeholder configuration; no Docker daemon was started.
- `kubectl kustomize k8s/base`: renders 11 documents. The dev overlay renders 20 documents with temporary synthetic Secret values. A YAML check confirms API/worker probes, resource limits, tokenless identity and read-only root filesystems.

## Remaining environment checks

CI is configured to run the seven integration tests with PostgreSQL 17. They test actual migrations, source row-lock concurrency, metadata/batch idempotency, incomplete snapshots, safe deletion, terminal failure and tombstones. They have not been run locally because PostgreSQL is not installed. A dedicated disposable database is required; these tests truncate their catalog tables.

No Redis/BullMQ live integration, container build/start, real supplier call, large-catalog load benchmark, cloud provisioning or Kubernetes server-side validation/deployment was performed locally. Container image publication occurs only when the repository's CI succeeds. Kubernetes dependency workloads are ephemeral development examples. The Next.js example is documentation and was not run in a frontend project.

## Failure diagnostics review fix

Worker failures now include bounded error categories/codes, valid PostgreSQL SQLSTATE, allowlisted network/timeout codes and safe supplier HTTP status. Both workers register BullMQ failed/error event handlers. Import failure status persists the same sanitized JSON classification; failure-recording errors are classified before the original job failure is rethrown. No arbitrary exception message/stack, supplier URL/token/body or database connection string is logged. Nine regression tests cover classification, redaction, worker events, unexpected identity hashing and persisted diagnostics; the first seven were observed failing before implementation. Live queue event delivery remains unverified locally.
