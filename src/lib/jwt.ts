import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';

// КРИТИЧЕСКИ ВАЖНО: эти значения должны совпадать с llm-hub!
const JWT_ISSUER = 'mitkadem';
const JWT_AUDIENCE = 'internal';

export interface ServiceTokenPayload {
  sub: string;
  aud: string;
  iss: string;
  tenantId?: string;
  workflowId?: string;
  commandId?: string;
  permissions?: string[];
}

/**
 * Создаёт JWT для service-to-service вызовов
 * ВАЖНО: issuer='mitkadem', НЕ название сервиса!
 */
export function signServiceToken(
  subject: string = 'writer',
  context?: {
    tenantId: string;
    workflowId: string;
    commandId: string;
    permissions: string[];
  },
): string {
  const env = getEnv();
  return jwt.sign(
    { sub: subject, aud: JWT_AUDIENCE, iss: JWT_ISSUER, ...context },
    env.SERVICE_JWT_SECRET,
    { expiresIn: 300, algorithm: 'HS256', jwtid: context?.commandId }
  );
}

/**
 * Верифицирует входящий JWT токен
 */
export function verifyToken(token: string): ServiceTokenPayload {
  const env = getEnv();
  return jwt.verify(token, env.SERVICE_JWT_SECRET, {
    algorithms: ['HS256'],
    audience: JWT_AUDIENCE,
  }) as ServiceTokenPayload;
}

/**
 * Создаёт dev токен для тестирования (1 час)
 */
export function signDevToken(name: string): string {
  const env = getEnv();
  return jwt.sign(
    { sub: name, aud: JWT_AUDIENCE, iss: env.SERVICE_NAME },
    env.SERVICE_JWT_SECRET,
    { expiresIn: 3600 } // 1 час
  );
}
