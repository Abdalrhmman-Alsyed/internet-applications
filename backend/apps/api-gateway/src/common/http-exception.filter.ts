import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

/** 403 → "Forbidden", 422 → "Unprocessable Entity" */
const statusName = (code: number) =>
  (HttpStatus[code] ?? 'ERROR')
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/**
 * One error format for the whole API:
 * { success: false, statusCode, error, message, path, method, timestamp }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      const b = typeof body === 'string' ? { message: body } : (body as { message?: string | string[]; error?: string });
      message = b.message ?? exception.message;
      error = b.error ?? statusName(statusCode);
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(statusCode).json({
      success: false,
      statusCode,
      error,
      message,
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
  }
}
