import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../vocabularies';

export const IS_PUBLIC_KEY = 'sw:isPublic';
export const ROLES_KEY = 'sw:roles';

/** Marks a route as reachable without a bearer token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated principal attached by {@link JwtStrategy}. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  tokenVersion: number;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    return data ? user?.[data] : user;
  },
);
