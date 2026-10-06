import { parseSupplierPage, readBoundedJson } from '../src/supplier/supplier-policy';
const product = {
  externalId: 'fixture',
  name: 'Synthetic',
  price: '12.00',
  variations: [{ sku: 'fixture-blue', attributes: { color: 'blue' }, quantity: 3 }],
};
describe('operator-configured supplier boundary', () => {
  it('validates a bounded page and declared total pages', () =>
    expect(parseSupplierPage({ totalPages: 2, products: [product] })).toEqual({
      totalPages: 2,
      products: [product],
    }));
  it('rejects an empty snapshot page', () =>
    expect(() => parseSupplierPage({ totalPages: 1, products: [] })).toThrow('products'));
  it('rejects unbounded total pages', () =>
    expect(() => parseSupplierPage({ totalPages: 10001, products: [product] })).toThrow(
      'totalPages',
    ));
  it('rejects a response before accumulating more than the byte ceiling', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(513 * 1024));
        c.close();
      },
    });
    await expect(readBoundedJson(new Response(stream))).rejects.toThrow('512');
  });
});
