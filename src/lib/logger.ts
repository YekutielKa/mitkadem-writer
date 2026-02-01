import pino from 'pino';
import { getEnv } from '../config/env';

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: env.SERVICE_NAME,
    env: env.NODE_ENV,
  },
});
