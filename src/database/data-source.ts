import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User, Product, Variation, Stock } from './entities';
import { Initial1760000000000 } from './migrations/1760000000000-Initial';
export const databaseOptions = () => ({
  type: 'postgres' as const,
  url: process.env.DATABASE_URL,
  entities: [User, Product, Variation, Stock],
  migrations: [Initial1760000000000],
  synchronize: false,
  extra: { connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 5000 },
  migrationsRun: false,
});
export default new DataSource(databaseOptions());
