import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { mapProduct, ProductInput, VariationInput } from '../catalog/product-policy';

// The parser handles quoted commas/newlines; stream backpressure keeps file size out of memory.
export async function* csvBatches(file: string): AsyncGenerator<ProductInput[]> {
  const source = createReadStream(file);
  const parser = source.pipe(
    parse({ columns: true, bom: true, skip_empty_lines: true, max_record_size: 128 * 1024 }),
  );
  source.on('error', (error) => parser.destroy(error));
  let batch: ProductInput[] = [];
  let bytes = 16;
  try {
    for await (const value of parser) {
      const row = value as Record<string, string>;
      if (row.deleted !== 'true' && row.deleted !== 'false')
        throw new Error('CSV deleted must be true or false');
      const product = mapProduct({
        externalId: row.externalId,
        name: row.name,
        price: row.price,
        deleted: row.deleted === 'true',
        variations: JSON.parse(row.variations) as VariationInput[],
      });
      const productBytes = Buffer.byteLength(JSON.stringify(product)) + 1;
      if (batch.length && (batch.length === 100 || bytes + productBytes > 500 * 1024)) {
        yield batch;
        batch = [];
        bytes = 16;
      }
      batch.push(product);
      bytes += productBytes;
    }
    if (batch.length) yield batch;
  } finally {
    source.destroy();
    parser.destroy();
  }
}
