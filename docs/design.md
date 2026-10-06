# Approved implementation scope

An original NestJS portfolio application; synthetic products only. PostgreSQL stores users, supplier ownership, products, variations, stock and staged imports. API and worker processes share feature modules but only the worker consumes jobs. Imports are bounded to 100 products per batch and 10,000 batches per run. A source permits one active run; conflicting submissions receive 409. Clients explicitly seal a staged run before processing. Snapshot deletion is a final transaction after all expected batches succeed. Batch writes and progress commit together; retries skip committed batches. Queue delivery is reconciled from PostgreSQL every 15 seconds. Failure preserves committed upserts but never deletes missing products.

JWT roles are seeded out-of-band. No registration or client-selected supplier URL. Supplier fetching uses an operator-configured HTTPS URL and a documented bounded response schema. Kubernetes deployment is an example, not claimed live operation.

Implementation sequence: failing mapping/snapshot/role tests; domain behavior; durable schema and import store; HTTP/auth/cache; BullMQ and supplier scheduling; container/Kubernetes/CI; fresh build/tests and review.
