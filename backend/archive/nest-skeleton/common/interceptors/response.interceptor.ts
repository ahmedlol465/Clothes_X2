import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Wraps every successful response in a stable envelope. `X-Total-Count` is
 * lifted out of `meta` so list screens can page without parsing the body.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T>> {
    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && (data as any).__raw) {
          response.setHeader?.('X-Total-Count', String((data as any).total ?? 0));
          return {
            success: true as const,
            data: (data as any).items,
            meta: { total: (data as any).total ?? 0, page: (data as any).page, limit: (data as any).limit },
            timestamp: new Date().toISOString(),
          };
        }

        const body: ApiEnvelope<T> = {
          success: true,
          data,
          timestamp: new Date().toISOString(),
        };
        if (data && typeof data === 'object' && Array.isArray((data as any).items)) {
          body.meta = { total: (data as any).total, page: (data as any).page, limit: (data as any).limit };
        }
        return body;
      }),
    );
  }
}

/** Wraps a paginated query result so the interceptor can detect it. */
export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): { __raw: true; items: T[]; total: number; page: number; limit: number } {
  return { __raw: true, items, total, page, limit };
}
