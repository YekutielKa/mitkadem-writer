import pino from 'pino';
import { getEnv } from '../config/env';

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: env.SERVICE_NAME,
    env: env.NODE_ENV,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-dev-secret"]',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.SERVICE_JWT_SECRET',
      '*.DEV_ADMIN_SECRET',
      '*.DATABASE_URL',
      '*.DATABASE_URL_WRITER',
    ],
    censor: '[REDACTED]',
  },
});
