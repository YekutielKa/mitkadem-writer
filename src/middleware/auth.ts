import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { logger } from '../lib/logger';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'missing token' });
    return;
  }

  try {
    verifyToken(token);
    next();
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Auth failed');
    res.status(401).json({ error: 'unauthorized' });
  }
}
