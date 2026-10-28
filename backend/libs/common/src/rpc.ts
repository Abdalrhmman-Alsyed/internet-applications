import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  RpcExceptionFilter as NestRpcExceptionFilter,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom, Observable, throwError, timeout } from 'rxjs';

/** Error shape that travels over TCP from a service back to the gateway. */
export interface RpcErrorPayload {
  statusCode: number;
  message: string | string[];
  error: string;
}

/**
 * Global filter for every microservice: turns Nest HttpExceptions
 * (NotFoundException, ForbiddenException, ...) thrown inside services into a
 * serialisable payload that keeps the HTTP status code.
 */
@Catch()
export class AllRpcExceptionsFilter implements NestRpcExceptionFilter {
  private readonly logger = new Logger('RpcExceptions');

  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const body = typeof res === 'string' ? { message: res } : (res as Record<string, unknown>);
      return throwError(() => ({
        statusCode: exception.getStatus(),
        message: (body.message as string | string[]) ?? exception.message,
        error: (body.error as string) ?? exception.name,
      }));
    }
    if (exception instanceof RpcException) {
      const err = exception.getError();
      return throwError(() =>
        typeof err === 'object' ? err : { statusCode: 400, message: err, error: 'Bad Request' },
      );
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return throwError(() => ({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    }));
  }
}

function isRpcErrorPayload(err: unknown): err is RpcErrorPayload {
  return typeof err === 'object' && err !== null && typeof (err as RpcErrorPayload).statusCode === 'number';
}

/**
 * Sends a request to a service and waits for the reply. Service errors are
 * re-thrown as HttpExceptions with the original status; an unreachable or slow
 * service becomes 503.
 */
export async function sendRpc<T = unknown>(
  client: ClientProxy,
  pattern: string,
  data: unknown,
  timeoutMs = 8000,
): Promise<T> {
  try {
    return await firstValueFrom(client.send<T>(pattern, data ?? {}).pipe(timeout(timeoutMs)));
  } catch (err) {
    if (isRpcErrorPayload(err)) {
      throw new HttpException(
        { statusCode: err.statusCode, message: err.message, error: err.error },
        err.statusCode,
      );
    }
    throw new ServiceUnavailableException(`Upstream service unavailable (${pattern})`);
  }
}
