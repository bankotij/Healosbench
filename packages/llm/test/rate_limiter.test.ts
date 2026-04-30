import { describe, expect, test } from "bun:test";

import { Semaphore, withRateLimitRetry } from "../src/rate_limiter";

class FakeStatusError extends Error {
  status: number;
  headers: Record<string, string>;
  constructor(status: number, headers: Record<string, string> = {}) {
    super(`HTTP ${status}`);
    this.status = status;
    this.headers = headers;
  }
}

describe("Semaphore", () => {
  test("limits concurrent task execution to `permits`", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const pause = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    const tasks = Array.from({ length: 10 }).map(() =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await pause();
        active--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  test("releases the permit even when the task throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Subsequent tasks should still be able to acquire.
    const v = await sem.run(async () => 42);
    expect(v).toBe(42);
  });

  test("rejects non-positive permits", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });
});

describe("withRateLimitRetry()", () => {
  test("retries on 429 and eventually succeeds", async () => {
    let calls = 0;
    const onRetry = (info: { attempt: number; delayMs: number; error: unknown }) => {
      // Just observed for assertion.
      void info;
    };
    const result = await withRateLimitRetry(
      async () => {
        calls++;
        if (calls < 3) throw new FakeStatusError(429);
        return "ok";
      },
      {
        sleep: async () => {}, // skip real waiting
        onRetry,
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("respects Retry-After header (in seconds)", async () => {
    const observedDelays: number[] = [];
    let calls = 0;
    await withRateLimitRetry(
      async () => {
        calls++;
        if (calls === 1) throw new FakeStatusError(429, { "retry-after": "2" });
        return "ok";
      },
      {
        sleep: async (ms) => {
          observedDelays.push(ms);
        },
      },
    );
    expect(observedDelays[0]).toBe(2000);
  });

  test("does NOT retry on a 400-class error other than 429", async () => {
    let calls = 0;
    await expect(
      withRateLimitRetry(
        async () => {
          calls++;
          throw new FakeStatusError(400);
        },
        { sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("gives up after maxRetries", async () => {
    let calls = 0;
    await expect(
      withRateLimitRetry(
        async () => {
          calls++;
          throw new FakeStatusError(429);
        },
        { maxRetries: 2, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    // 1 initial call + 2 retries = 3 attempts.
    expect(calls).toBe(3);
  });

  test("retries on transient network errors (ECONNRESET) and 529 overload", async () => {
    const transient = (code: string) => {
      const e = new Error(code);
      (e as Error & { code: string }).code = code;
      return e;
    };
    let calls = 0;
    const r = await withRateLimitRetry(
      async () => {
        calls++;
        if (calls === 1) throw transient("ECONNRESET");
        if (calls === 2) throw new FakeStatusError(529);
        return "done";
      },
      { sleep: async () => {} },
    );
    expect(r).toBe("done");
    expect(calls).toBe(3);
  });
});
