import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { csvBatches } from '../src/cli/csv-batches';
const row = (id: number) =>
  `${id},"Synthetic, lamp",19.90,false,"[{""sku"":""sku-${id}"",""attributes"":{""color"":""blue""},""quantity"":2}]"\n`;
describe('streaming CSV import', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'catalog-csv-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('handles quoted fields and bounds each batch to 100 products', async () => {
    const file = join(directory, 'fixture.csv');
    await writeFile(
      file,
      'externalId,name,price,deleted,variations\n' +
        Array.from({ length: 205 }, (_, i) => row(i)).join(''),
    );
    const sizes: number[] = [];
    for await (const batch of csvBatches(file)) {
      sizes.push(batch.length);
      expect(batch[0].name).toBe('Synthetic, lamp');
    }
    expect(sizes).toEqual([100, 100, 5]);
  });
  it('rejects invalid rows before successful parsing can finish', async () => {
    const file = join(directory, 'invalid.csv');
    await writeFile(file, 'externalId,name,price,deleted,variations\ninvalid,name,NaN,false,[]\n');
    await expect(
      (async () => {
        for await (const _batch of csvBatches(file)) {
          /* consume */
        }
      })(),
    ).rejects.toThrow('price');
  });
});
