import 'dotenv/config';
import { createHash } from 'node:crypto';
import { csvBatches } from './csv-batches';
import { required } from '../common/config';
interface RunResponse {
  id: string;
  status: string;
}
async function main(): Promise<void> {
  const [file, source, idempotencyKey] = process.argv.slice(2);
  if (
    !file ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(source ?? '') ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(idempotencyKey ?? '')
  )
    throw new Error('Usage: npm run import:csv -- file.csv source idempotency-key');
  const firstHash = createHash('sha256');
  let expectedBatches = 0;
  for await (const batch of csvBatches(file)) {
    firstHash.update(JSON.stringify(batch));
    expectedBatches++;
    if (expectedBatches > 10000) throw new Error('CSV exceeds 10,000 batches');
  }
  if (!expectedBatches) throw new Error('Empty CSV snapshots are forbidden');
  const firstDigest = firstHash.digest('hex');
  const base = required('CATALOG_API_URL');
  let token = process.env.CATALOG_TOKEN;
  const renewToken = async (): Promise<string> => {
    const response = await fetch(new URL('/auth/login', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: required('CATALOG_EMAIL'),
        password: required('CATALOG_PASSWORD'),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('CSV authentication failed');
    const body = (await response.json()) as { accessToken: string };
    return body.accessToken;
  };
  token ??= await renewToken();
  const send = async (path: string, method: string, body?: unknown): Promise<unknown> => {
    const request = () =>
      fetch(new URL(path, base), {
        method,
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    let response = await request();
    if (response.status === 401 && process.env.CATALOG_EMAIL && process.env.CATALOG_PASSWORD) {
      token = await renewToken();
      response = await request();
    }
    if (!response.ok)
      throw new Error(
        `Catalog returned HTTP ${response.status}; staged data remains unsealed, inspect or abort the run`,
      );
    return response.json() as Promise<unknown>;
  };
  const run = (await send('/imports', 'POST', {
    source,
    mode: 'snapshot',
    idempotencyKey,
    expectedBatches,
  })) as RunResponse;
  console.log(JSON.stringify({ runId: run.id, status: run.status, expectedBatches }));
  if (run.status !== 'staging') return;
  const secondHash = createHash('sha256');
  let ordinal = 0;
  for await (const products of csvBatches(file)) {
    secondHash.update(JSON.stringify(products));
    await send(`/imports/${run.id}/batches/${ordinal++}`, 'PUT', { products });
    // The API intentionally caps requests per process; keep a single CLI comfortably below its limit.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (ordinal !== expectedBatches || secondHash.digest('hex') !== firstDigest)
    throw new Error('CSV changed during import; run remains unsealed');
  await send(`/imports/${run.id}/seal`, 'POST');
  console.log(JSON.stringify({ runId: run.id, status: 'queued' }));
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'CSV import failed');
  process.exitCode = 1;
});
