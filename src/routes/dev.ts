import { Router, Request, Response } from 'express';
import { getEnv } from '../config/env';
import { signDevToken } from '../lib/jwt';

const router = Router();

// Mint dev token for testing
router.post('/mint', (req: Request, res: Response) => {
  const env = getEnv();
  const devSecret = req.headers['x-dev-secret'] as string;

  if (!env.DEV_ADMIN_SECRET || devSecret !== env.DEV_ADMIN_SECRET) {
    res.status(401).json({ error: 'bad dev secret' });
    return;
  }

  const name = (req.body?.name as string) || 'svc:cli';
  const token = signDevToken(name);

  res.json({ token });
});

export default router;
