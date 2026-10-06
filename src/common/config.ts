export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
export function checkConfig(): void {
  required('DATABASE_URL');
  required('REDIS_HOST');
  if (required('JWT_SECRET').length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters');
  if (
    process.env.SUPPLIER_SOURCE &&
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(process.env.SUPPLIER_SOURCE)
  )
    throw new Error('SUPPLIER_SOURCE is invalid');
  if (process.env.SUPPLIER_URL && new URL(process.env.SUPPLIER_URL).protocol !== 'https:')
    throw new Error('SUPPLIER_URL must use HTTPS');
}
export const redisOptions = () => ({
  host: required('REDIS_HOST'),
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});
