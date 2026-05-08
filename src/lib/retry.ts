/**
 * Retry helper with exponential backoff + jitter.
 *
 * BLOCK_30.7 Sprint 1 — writer priors-client reliability hardening
 * (Sprint 3 NOTE BLOCK_30.5 absorption). Reusable for any async operation
 * that may experience transient failure (network blip, upstream cold-start,
 * connection-pool transient exhaustion).
 *
 * Token Q-K discipline: NEVER pass credential-bearing closures to the
 * onAttemptError callback in a way that exposes them to log streams; callers
 * are responsible for sanitizing any error shape before logging.
 */

export interface RetryOptions {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
}

export class RetryExhaustedError extends Error {
  public readonly attempts: number;
  public readonly lastError: unknown;
  constructor(message: string, attempts: number, lastError: unknown) {
    super(message);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
  onAttemptError?: (attempt: number, error: unknown) => void,
): Promise<T> {
  if (opts.maxAttempts < 1) {
    throw new Error(`retryWithBackoff: maxAttempts must be >=1 (got ${opts.maxAttempts})`);
  }
  const baseMs = Math.max(0, opts.baseMs);
  const maxMs = Math.max(baseMs, opts.maxMs);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (onAttemptError) {
        try {
          onAttemptError(attempt, err);
        } catch {
          // observer must not break retry loop
        }
      }
      if (attempt >= opts.maxAttempts) break;
      const exp = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
      const jitter = exp * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
  throw new RetryExhaustedError(
    `retry exhausted after ${opts.maxAttempts} attempts`,
    opts.maxAttempts,
    lastError,
  );
}
