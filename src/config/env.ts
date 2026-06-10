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
  // R4 USE-DATA A2 (writer follow-up) — gate the researcher MARKET advisory block
  // in the content brief. Same flag the marketing-brain / tenant-brain wiring
  // reads. Default OFF → prompt byte-for-byte (the advisory block is skipped even
  // if tenant-brain happened to send marketContext).
  RESEARCH_USE_DATA_V2: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
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
  // BLOCK_30.7 Sprint 1 — priors-client retry + circuit breaker reliability
  // hardening (Sprint 3 NOTE BLOCK_30.5 absorption). Defaults conservative;
  // tunable post-baseline. Dormant until writer Path B activation flips
  // BRIEF_QUALITY_LOOKUP_ENABLED — successor block scope.
  PRIORS_CLIENT_RETRY_MAX_ATTEMPTS: z
    .string()
    .optional()
    .default('3')
    .transform((v) => Math.max(1, parseInt(v, 10) || 3)),
  PRIORS_CLIENT_RETRY_BASE_MS: z
    .string()
    .optional()
    .default('100')
    .transform((v) => Math.max(10, parseInt(v, 10) || 100)),
  PRIORS_CLIENT_RETRY_MAX_MS: z
    .string()
    .optional()
    .default('2000')
    .transform((v) => Math.max(10, parseInt(v, 10) || 2000)),
  PRIORS_CLIENT_BREAKER_FAILURE_THRESHOLD: z
    .string()
    .optional()
    .default('5')
    .transform((v) => Math.max(1, parseInt(v, 10) || 5)),
  PRIORS_CLIENT_BREAKER_COOLDOWN_SEC: z
    .string()
    .optional()
    .default('30')
    .transform((v) => Math.max(1, parseInt(v, 10) || 30)),
  // BLOCK_30.10 Sprint 1 — brief-quality-lookup retry + circuit breaker reliability
  // hardening (3rd verbatim port; mirror priors-client pattern BLOCK_30.7 Sprint 1).
  // Defaults conservative; tunable post-baseline. Operates against dormant code path
  // until BRIEF_QUALITY_LOOKUP_ENABLED=true (D13.8 halt Sprint 8 BLOCK_30.5; future
  // block decision).
  BRIEF_QUALITY_LOOKUP_RETRY_MAX_ATTEMPTS: z
    .string()
    .optional()
    .default('3')
    .transform((v) => Math.max(1, parseInt(v, 10) || 3)),
  BRIEF_QUALITY_LOOKUP_RETRY_BASE_MS: z
    .string()
    .optional()
    .default('100')
    .transform((v) => Math.max(10, parseInt(v, 10) || 100)),
  BRIEF_QUALITY_LOOKUP_RETRY_MAX_MS: z
    .string()
    .optional()
    .default('2000')
    .transform((v) => Math.max(10, parseInt(v, 10) || 2000)),
  BRIEF_QUALITY_LOOKUP_BREAKER_FAILURE_THRESHOLD: z
    .string()
    .optional()
    .default('5')
    .transform((v) => Math.max(1, parseInt(v, 10) || 5)),
  BRIEF_QUALITY_LOOKUP_BREAKER_COOLDOWN_SEC: z
    .string()
    .optional()
    .default('30')
    .transform((v) => Math.max(1, parseInt(v, 10) || 30)),
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
