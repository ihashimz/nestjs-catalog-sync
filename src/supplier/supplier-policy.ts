import { mapProduct, ProductInput } from '../catalog/product-policy';
export function parseSupplierPage(value: unknown): {
  totalPages: number;
  products: ProductInput[];
} {
  if (!value || typeof value !== 'object') throw new Error('Supplier response must be an object');
  const page = value as { totalPages?: unknown; products?: unknown };
  if (
    typeof page.totalPages !== 'number' ||
    !Number.isInteger(page.totalPages) ||
    page.totalPages < 1 ||
    page.totalPages > 10000
  )
    throw new Error('totalPages must be between 1 and 10000');
  if (!Array.isArray(page.products) || page.products.length < 1 || page.products.length > 100)
    throw new Error('products must contain 1 to 100 entries');
  return {
    totalPages: page.totalPages,
    products: page.products.map((item) => mapProduct(item as ProductInput)),
  };
}
export async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Supplier response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 512 * 1024) throw new Error('Supplier response exceeds 512 KiB');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
