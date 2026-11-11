import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { map, Observable } from 'rxjs';

/**
 * HTTP caching for the catalogue (products, categories).
 *
 * The ETag is a fingerprint of the response. The client sends it back in
 * If-None-Match; if the data hasn't changed the answer is 304 with no body, so
 * nothing is downloaded again. Any change (an admin edit, a stock change) gives a
 * new fingerprint, so a client never keeps stale data.
 *
 * "no-cache" means "you may keep it, but ask me before using it" (not "don't store").
 * Responses for a signed-in caller are "private" so shared caches never reuse them.
 */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((body) => {
        const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', `${req.headers.authorization ? 'private' : 'public'}, no-cache`);
        const sent = req.headers['if-none-match'];
        if (sent && sent.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
          res.status(304);
          return undefined; // 304 Not Modified: headers only, no body
        }
        return body;
      }),
    );
  }
}
