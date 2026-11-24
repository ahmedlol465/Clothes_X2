import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** Uniform error envelope so the Flutter client has one shape to parse. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] | Record<string, unknown> =
      exception instanceof HttpException
        ? (exception.getResponse() as string | string[] | Record<string, unknown>)
        : 'Internal server error';

    if (typeof message === 'object' && message !== null) {
      const payload = message as { message?: string | string[]; error?: unknown };
      message =
        payload.message ??
        (typeof payload.error === 'string' ? payload.error : undefined) ??
        'Request failed';
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // The Flutter client reads `error`; keep it human-readable instead of the
    // HTTP status name so the UI can show the actual validation problem.
    const human = Array.isArray(message) ? message.join(', ') : message;

    response.status(status).json({
      statusCode: status,
      error: human,
      message: human,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
