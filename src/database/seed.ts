import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import dataSource from './data-source';
import { hashPassword } from '../auth/password';
import { required } from '../common/config';
async function seed(): Promise<void> {
  const password = required('SEED_PASSWORD');
  if (password.length < 12 || password.length > 128)
    throw new Error('SEED_PASSWORD must have 12 to 128 characters');
  const email = required('SEED_EMAIL').toLowerCase();
  const role = process.env.SEED_ROLE ?? 'viewer';
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !['viewer', 'manager'].includes(role)
  )
    throw new Error('Invalid seed identity or role');
  await dataSource.initialize();
  try {
    await dataSource.query(
      'INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role',
      [randomUUID(), email, await hashPassword(password), role],
    );
  } finally {
    await dataSource.destroy();
  }
}
void seed().catch(() => {
  console.error('Seed failed; check configuration and database migration');
  process.exitCode = 1;
});
