import { hashPassword, verifyPassword } from '../src/auth/password';
import { RolesGuard, Roles } from '../src/auth/guards';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
class ImportEndpoint {
  @Roles('manager') submit() {}
}
const context = (user?: { role: string }) =>
  ({
    getHandler: () => ImportEndpoint.prototype.submit,
    getClass: () => ImportEndpoint,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;
describe('security boundaries', () => {
  it('hashes with a random salt and rejects wrong passwords', async () => {
    const first = await hashPassword('synthetic-password-123');
    const second = await hashPassword('synthetic-password-123');
    expect(first).not.toBe(second);
    expect(await verifyPassword('synthetic-password-123', first)).toBe(true);
    expect(await verifyPassword('wrong', first)).toBe(false);
  });
  it('rejects malformed stored hashes', async () =>
    expect(await verifyPassword('password', 'invalid')).toBe(false));
  it('denies imports without a principal', () =>
    expect(new RolesGuard(new Reflector()).canActivate(context())).toBe(false));
  it('denies imports for a viewer', () =>
    expect(new RolesGuard(new Reflector()).canActivate(context({ role: 'viewer' }))).toBe(false));
  it('permits manager imports', () =>
    expect(new RolesGuard(new Reflector()).canActivate(context({ role: 'manager' }))).toBe(true));
});
