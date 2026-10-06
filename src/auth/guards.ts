import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Role, permits } from './role-policy';
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {}
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]) ?? ['viewer', 'manager'];
    const user = context.switchToHttp().getRequest<{ user?: { role: Role } }>().user;
    return !!user && permits(user.role, roles);
  }
}
