/**
 * Circuit breaker state machine: CLOSED → OPEN → HALF_OPEN → CLOSED.
 *
 * BLOCK_30.7 Sprint 1 — writer priors-client reliability hardening
 * (Sprint 3 NOTE BLOCK_30.5 absorption). Trips OPEN after `failureThreshold`
 * consecutive failures; cooldown waits `cooldownMs` before allowing a single
 * HALF_OPEN probe; closes again after `successThreshold` consecutive
 * HALF_OPEN successes.
 *
 * Token Q-K discipline: state-transition observer callback receives only
 * the transition vector (`from` → `to`); caller is responsible для не leaking
 * credential-bearing context.
 */

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  successThreshold?: number;
}

export class CircuitBreakerOpenError extends Error {
  public readonly cooldownRemainingMs: number;
  constructor(cooldownRemainingMs: number) {
    super(`circuit breaker OPEN; cooldown remaining ${cooldownRemainingMs}ms`);
    this.name = 'CircuitBreakerOpenError';
    this.cooldownRemainingMs = cooldownRemainingMs;
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveHalfOpenSuccesses = 0;
  private openedAt = 0;
  private readonly successThreshold: number;
  private readonly opts: CircuitBreakerOptions;
  private readonly onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;

  constructor(
    opts: CircuitBreakerOptions,
    onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void,
  ) {
    if (opts.failureThreshold < 1) {
      throw new Error(`CircuitBreaker: failureThreshold must be >=1 (got ${opts.failureThreshold})`);
    }
    if (opts.cooldownMs < 0) {
      throw new Error(`CircuitBreaker: cooldownMs must be >=0 (got ${opts.cooldownMs})`);
    }
    this.opts = opts;
    this.onStateChange = onStateChange;
    this.successThreshold = Math.max(1, opts.successThreshold ?? 1);
  }

  getState(): CircuitBreakerState {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.opts.cooldownMs) {
      this.transition('OPEN', 'HALF_OPEN');
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const current = this.getState();
    if (current === 'OPEN') {
      const remaining = Math.max(0, this.opts.cooldownMs - (Date.now() - this.openedAt));
      throw new CircuitBreakerOpenError(remaining);
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.consecutiveHalfOpenSuccesses += 1;
      if (this.consecutiveHalfOpenSuccesses >= this.successThreshold) {
        this.transition('HALF_OPEN', 'CLOSED');
      }
      return;
    }
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.transition('HALF_OPEN', 'OPEN');
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.opts.failureThreshold) {
      this.transition('CLOSED', 'OPEN');
    }
  }

  private transition(from: CircuitBreakerState, to: CircuitBreakerState): void {
    this.state = to;
    if (to === 'OPEN') {
      this.openedAt = Date.now();
      this.consecutiveHalfOpenSuccesses = 0;
    } else if (to === 'CLOSED') {
      this.consecutiveFailures = 0;
      this.consecutiveHalfOpenSuccesses = 0;
    } else if (to === 'HALF_OPEN') {
      this.consecutiveHalfOpenSuccesses = 0;
    }
    if (this.onStateChange) {
      try {
        this.onStateChange(from, to);
      } catch {
        // observer must not break breaker invariant
      }
    }
  }
}
