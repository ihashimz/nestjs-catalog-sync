export interface VariationInput {
  sku: string;
  attributes: Record<string, string>;
  quantity: number;
}
export interface ProductInput {
  deleted?: boolean;
  externalId: string;
  name: string;
  price: string;
  variations: VariationInput[];
}
export function variationIdentity(attributes: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(attributes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
export function mapProduct(input: ProductInput): ProductInput {
  if (input?.deleted !== undefined && typeof input.deleted !== 'boolean')
    throw new Error('deleted must be a boolean');
  if (
    !input ||
    typeof input.externalId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(input.externalId)
  )
    throw new Error('externalId is invalid');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 240)
    throw new Error('name is invalid');
  if (typeof input.price !== 'string' || !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(input.price))
    throw new Error('price must be a non-negative decimal string with two places');
  if (
    !Array.isArray(input.variations) ||
    input.variations.length < 1 ||
    input.variations.length > 20
  )
    throw new Error('variations must contain 1 to 20 entries');
  const identities = new Set<string>();
  const skus = new Set<string>();
  const variations = input.variations.map((v) => {
    if (typeof v.sku !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(v.sku))
      throw new Error('sku is invalid');
    if (!Number.isSafeInteger(v.quantity) || v.quantity < 0 || v.quantity > 2147483647)
      throw new Error('quantity must be a non-negative integer');
    if (!v.attributes || typeof v.attributes !== 'object' || Array.isArray(v.attributes))
      throw new Error('attributes are invalid');
    const entries = Object.entries(v.attributes);
    if (
      !entries.length ||
      entries.length > 8 ||
      entries.some(
        ([k, value]) =>
          !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k) ||
          typeof value !== 'string' ||
          !value.trim() ||
          value.length > 80,
      )
    )
      throw new Error('attributes are invalid');
    const identity = variationIdentity(v.attributes);
    if (identities.has(identity) || skus.has(v.sku))
      throw new Error('duplicate variation identity or sku');
    identities.add(identity);
    skus.add(v.sku);
    return {
      sku: v.sku,
      attributes: Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
      quantity: v.quantity,
    };
  });
  return {
    ...(input.deleted !== undefined ? { deleted: input.deleted } : {}),
    externalId: input.externalId,
    name: input.name.trim(),
    price: input.price,
    variations,
  };
}
export function snapshotCanDelete(run: {
  mode: string;
  status: string;
  expected: number;
  processed: number;
}): boolean {
  return (
    run.mode === 'snapshot' &&
    run.status === 'succeeded' &&
    run.expected > 0 &&
    run.processed === run.expected
  );
}
