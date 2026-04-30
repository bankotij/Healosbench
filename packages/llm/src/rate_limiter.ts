/**
 * Concurrency primitives the runner uses so we never `Promise.all` the whole
 * dataset and so each LLM call survives a 429 from Anthropic.
 *
 * 429 strategy (also documented in NOTES.md):
 *   - On HTTP 429 / 529, sleep for `Retry-After` seconds if the header is set,
 *     otherwise back off exponentially (250ms, 500ms, 1s, 2s, 4s, capped at 8s)
 *     with ±20% jitter.
 *   - Retry up to 5 times. After that, propagate the error so the case is
 *     marked failed — the runner can resume failed cases later.
 *   - The semaphore caps in-flight cases, which is the primary protection;
 *     429 retry is a fallback when traffic still spikes (e.g. retries
 *     overlapping with steady-state work).
 */

export class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new Error(`Semaphore permits must be a positive integer, got ${permits}`);
    }
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

export interface RetryOptions {
  /** Max retry attempts (excluding the initial try). */
  maxRetries?: number;
  /** Base backoff in milliseconds. */
  baseMs?: number;
  /** Max backoff in milliseconds. */
  maxMs?: number;
  /** Hook called once per retry (useful for tests + logging). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Sleep impl (overridden in tests so the suite doesn't actually wait). */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `task` and retry on 429/529 (Anthropic's overloaded code) and on
 * transient network errors. Other errors propagate immediately.
 */
export async function withRateLimitRetry<T>(
  task: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseMs = opts.baseMs ?? 250;
  const maxMs = opts.maxMs ?? 8000;
  const sleep = opts.sleep ?? defaultSleep;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await task();
    } catch (err) {
      const status = extractStatus(err);
      const retryable = status === 429 || status === 529 || isTransientNetworkError(err);
      if (!retryable || attempt >= maxRetries) throw err;

      const retryAfterMs = parseRetryAfter(err);
      const expoMs = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = expoMs * 0.2 * (Math.random() * 2 - 1);
      const delayMs = Math.max(0, retryAfterMs ?? expoMs + jitter);

      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs);
      attempt++;
    }
  }
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { status?: number; statusCode?: number };
  return e.status ?? e.statusCode;
}

function parseRetryAfter(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  // The Anthropic SDK exposes response headers on APIError instances.
  const headers = (err as { headers?: Record<string, string> }).headers;
  if (!headers) return undefined;
  const v = headers["retry-after"] ?? headers["Retry-After"];
  if (!v) return undefined;
  const seconds = Number(v);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(v);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function isTransientNetworkError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: string }).code;
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENETUNREACH"
  );
}
