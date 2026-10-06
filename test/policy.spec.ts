import { mapProduct, snapshotCanDelete, ProductInput } from '../src/catalog/product-policy';
import { permits } from '../src/auth/role-policy';
const product: ProductInput = {
  externalId: 'lamp-1',
  name: 'Desk lamp',
  price: '19.90',
  variations: [{ sku: 'lamp-blue', attributes: { color: 'blue', size: 'small' }, quantity: 5 }],
};
describe('catalog trust boundary', () => {
  it('maps a decimal string without floating-point conversion', () =>
    expect(mapProduct(product)).toEqual(product));
  it.each(['-1.00', '1e3', 'NaN', '1.001', '10000000000.00'])('rejects invalid price %s', (price) =>
    expect(() => mapProduct({ ...product, price })).toThrow('price'),
  );
  it('rejects negative stock', () =>
    expect(() =>
      mapProduct({ ...product, variations: [{ ...product.variations[0], quantity: -1 }] }),
    ).toThrow('quantity'));
  it('rejects fractional stock', () =>
    expect(() =>
      mapProduct({ ...product, variations: [{ ...product.variations[0], quantity: 1.5 }] }),
    ).toThrow('quantity'));
  it('rejects duplicate variation identities independent of attribute order', () =>
    expect(() =>
      mapProduct({
        ...product,
        variations: [
          product.variations[0],
          { sku: 'second', attributes: { size: 'small', color: 'blue' }, quantity: 2 },
        ],
      }),
    ).toThrow('duplicate'));
  it('rejects duplicate sku', () =>
    expect(() =>
      mapProduct({
        ...product,
        variations: [
          product.variations[0],
          { sku: 'lamp-blue', attributes: { color: 'red' }, quantity: 2 },
        ],
      }),
    ).toThrow('duplicate'));
  it('allows only a fully successful sealed snapshot to delete', () => {
    expect(
      snapshotCanDelete({ mode: 'snapshot', status: 'succeeded', expected: 2, processed: 2 }),
    ).toBe(true);
    for (const status of ['staging', 'queued', 'processing', 'retrying', 'failed'])
      expect(snapshotCanDelete({ mode: 'snapshot', status, expected: 2, processed: 1 })).toBe(
        false,
      );
    expect(
      snapshotCanDelete({ mode: 'delta', status: 'succeeded', expected: 2, processed: 2 }),
    ).toBe(false);
  });
});
describe('roles', () => {
  it('forbids a viewer from importing', () => expect(permits('viewer', ['manager'])).toBe(false));
  it('allows both authenticated roles to read', () => {
    expect(permits('viewer', ['viewer', 'manager'])).toBe(true);
    expect(permits('manager', ['viewer', 'manager'])).toBe(true);
  });
});

describe('supplier tombstones', () => {
  it('preserves an explicit deleted flag in the mapped product', () => {
    expect(mapProduct({ ...product, deleted: true }).deleted).toBe(true);
  });
  it('rejects a string instead of a deleted boolean', () => {
    expect(() => mapProduct({ ...product, deleted: 'true' } as unknown as ProductInput)).toThrow(
      'deleted',
    );
  });
});
