import crypto from 'node:crypto';
import { z } from 'zod';

export const TenantJobContextSchema = z.object({
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  commandId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  correlationId: z.string().min(1),
  traceId: z.string().min(1),
  authorityContext: z.object({
    actorType: z.enum(['user', 'service', 'system']),
    actorId: z.string().min(1),
    permissions: z.array(z.string().min(1)).min(1),
  }),
});

export const WriteJobSchema = TenantJobContextSchema.extend({
  taskId: z.string().uuid(),
});

export type TenantJobContext = z.infer<typeof TenantJobContextSchema>;
export type WriteJobData = z.infer<typeof WriteJobSchema>;

export function newCommandId(): string {
  return crypto.randomUUID();
}

export function requiredHeader(
  headers: Record<string, unknown>,
  name: string,
): string {
  const value = headers[name.toLowerCase()];
  const normalized = Array.isArray(value) ? value[0] : value;
  if (typeof normalized !== 'string' || normalized.trim() === '') {
    throw new Error(`missing_tenant_context:${name}`);
  }
  return normalized.trim();
}

