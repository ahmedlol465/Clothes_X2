import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthenticatedUser, ROLES_KEY } from '../decorators/auth.decorators';
import { UserRole } from '../vocabularies';

/** Section 4.17 Admin routes are restricted by role. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user: AuthenticatedUser = context.switchToHttp().getRequest().user;
    return !!user && required.includes(user.role);
  }
}
