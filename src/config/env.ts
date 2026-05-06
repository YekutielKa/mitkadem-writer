import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('8080').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SERVICE_NAME: z.string().default('mitkadem-writer'),
  SERVICE_JWT_SECRET: z.string().min(32),
  DEV_ADMIN_SECRET: z.string().default(''),
  // Database
  DATABASE_URL_WRITER: z.string().url(),
  // Redis (optional)
  REDIS_URL: z.string().optional(),
  // External services
  LLM_HUB_URL: z.string().url().default('https://mitkadem-llm-hub-production.up.railway.app'),
  TENANT_BRAIN_URL: z.string().url().default('https://mitkadem-tenant-brain-production.up.railway.app'),
  INSIGHTS_URL: z.string().url().default('https://mitkadem-insights-production.up.railway.app'),
  EVENTS_URL: z.string().url().default('https://mitkadem-events-production.up.railway.app'),
  // BLOCK_30 Sprint 4 — adapters-meta synthetic-default publish endpoint base URL.
  ADAPTERS_META_URL: z.string().url().default('https://mitkadem-adapters-meta-production.up.railway.app'),
  // BLOCK_30 Sprint 7 — Loop 1 writer-side consumer wire (Path B preferred per
  // Phase 0 #15: writer DB role queries public.learning_events directly,
  // preserves corpus #82 — no MARKETING_BRAIN_URL added). Default OFF.
  BRIEF_QUALITY_LOOKUP_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  BRIEF_QUALITY_MIN_CLUSTER_SAMPLE: z
    .string()
    .optional()
    .default('3')
    .transform((v) => Math.max(1, parseInt(v, 10) || 3)),
});

export type Env = z.infer<typeof envSchema>;
let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Environment validation failed:', parsed.error.format());
    process.exit(1);
  }
  _env = parsed.data;
  return _env;
}

// Validate on import
getEnv();
