/**
 * Request Correlation ID Middleware
 *
 * Generates a UUID per request (or reuses incoming X-Request-ID header),
 * attaches it to the request object, and adds it to the response headers.
 * Enables correlating API requests with downstream DB queries and script executions.
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const REQUEST_ID_HEADER = 'X-Request-ID';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Middleware that assigns a unique request ID to each request.
 * If the client sends an X-Request-ID header, it is reused (validated as safe string).
 * Otherwise a new UUID is generated.
 */
export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.get(REQUEST_ID_HEADER);
    // Reuse client-provided ID if it looks safe (alphanumeric + hyphens, max 64 chars)
    const requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  };
}
