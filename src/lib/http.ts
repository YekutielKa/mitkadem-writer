import { logger } from './logger';

export interface HttpOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 1000;

export async function httpPost<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  options: HttpOptions = {}
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error((errorBody as any).error || `HTTP ${res.status}`);
      }

      return await res.json() as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;

      if (attempt < retries) {
        logger.warn({ url, attempt, error: err.message }, 'HTTP request failed, retrying');
        await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('HTTP request failed');
}

export async function httpGet<T>(
  url: string,
  headers: Record<string, string> = {},
  options: HttpOptions = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error((errorBody as any).error || `HTTP ${res.status}`);
    }

    return await res.json() as T;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
