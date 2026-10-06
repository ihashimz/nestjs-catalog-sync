import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
const logger = new Logger('HTTP');
export function requestLogging(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  const start = performance.now();
  res.setHeader('x-request-id', requestId);
  res.on('finish', () => {
    logger.log(
      JSON.stringify({
        requestId,
        method: req.method,
        route: req.route?.path ?? 'unmatched',
        status: res.statusCode,
        durationMs: Math.round(performance.now() - start),
      }),
    );
  });
  next();
}
