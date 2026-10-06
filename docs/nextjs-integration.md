# Next.js integration

Use the Catalog API from a Next.js server component or server action. Keep `CATALOG_API_URL` and a short-lived user `CATALOG_ACCESS_TOKEN` in server-side configuration/session storage. Never place a token in `NEXT_PUBLIC_*` variables or expose a manager token to a browser. In an actual application, read each user's token from a secure server session instead of a shared environment variable.

```tsx
import 'server-only';

type Product = {
  id: string;
  source: string;
  externalId: string;
  name: string;
  price: string; // Preserve decimal strings at the UI boundary.
  variations: {
    id: string;
    sku: string;
    attributes: Record<string, string>;
    quantity: number;
  }[];
};
type ProductPage = { items: Product[]; page: number; limit: number };

export async function getProducts(page = 1): Promise<ProductPage> {
  const base = process.env.CATALOG_API_URL;
  const token = process.env.CATALOG_ACCESS_TOKEN;
  if (!base || !token) throw new Error('Catalog server configuration is missing');
  const url = new URL('/products', base);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', '20');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 401) throw new Error('Sign in again');
  if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
  // Types describe the server contract; add runtime decoding if consuming an untrusted API.
  return (await response.json()) as ProductPage;
}
```

The API has an independent 30-second Redis cache. `cache: 'no-store'` prevents Next.js from adding another potentially user-shared cache layer. Pagination returns the requested page and limit without a count query; an empty page indicates the end. Configure CORS only if a browser must call the API directly; server-side fetching requires no CORS policy.

This is integration documentation, not a shipped Next.js frontend. The example has not been executed in a Next.js application.
