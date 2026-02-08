import { Request, Response, NextFunction } from 'express';
import { verifyToken, ServiceTokenPayload } from '../lib/jwt';
import { logger } from '../lib/logger';

export interface AuthenticatedRequest extends Request {
  auth?: ServiceTokenPayload;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'missing token' });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.auth = payload;
    next();
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Auth failed');
    res.status(401).json({ error: 'unauthorized' });
  }
}

/**
 * Tenant isolation guard [H-8]
 * - Internal services (iss='mitkadem'): trust tenantId from body/params
 * - User tokens: tenantId must match JWT sub claim
 */
export function tenantGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Internal service calls — trusted
  if (auth.iss === 'mitkadem' && auth.aud === 'internal') {
    next();
    return;
  }

  // User calls — verify tenantId matches JWT
  const requestedTenant = req.body?.tenantId || req.params?.tenantId || req.query?.tenantId;
  if (requestedTenant && requestedTenant !== auth.sub) {
    logger.warn({ requestedTenant, authSub: auth.sub }, 'Tenant isolation violation');
    res.status(403).json({ error: 'forbidden', message: 'Access denied to this tenant' });
    return;
  }

  next();
}
