import { describe, expect, test } from "bun:test";

import { estimateCost } from "../src/estimate";

describe("estimateCost()", () => {
  const SHORT =
    "Patient presents with sore throat for 3 days, low-grade fever, no cough. " +
    "Vitals: BP 118/74, HR 78, T 99.4F, SpO2 99%. Plan: rapid strep, " +
    "ibuprofen 400mg q6h, return if worse.";

  test("single-case estimate has no cache_read (no prior call to read from)", () => {
    const e = estimateCost({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      transcripts: [SHORT],
    });
    expect(e.cases).toBe(1);
    expect(e.usage.cache_write).toBeGreaterThan(0);
    expect(e.usage.cache_read).toBe(0);
    expect(e.cost_usd).toBeGreaterThan(0);
    // Note: on N=1, caching is actively *more* expensive than no-cache
    // (cache_write is billed at 1.25× input with no reads to amortize over).
    // We surface both numbers in the dashboard so operators can see this.
    expect(e.cost_usd).toBeGreaterThan(e.cost_usd_no_cache);
  });

  test("break-even: caching pays off by N=3 (Haiku, zero-shot)", () => {
    let firstWin = 0;
    for (let n = 1; n <= 10; n++) {
      const e = estimateCost({
        strategy: "zero_shot",
        model: "claude-haiku-4-5-20251001",
        transcripts: Array.from({ length: n }, () => SHORT),
      });
      if (e.cost_usd < e.cost_usd_no_cache) {
        firstWin = n;
        break;
      }
    }
    // We expect caching to pay off by 3 cases at the latest.
    expect(firstWin).toBeGreaterThan(0);
    expect(firstWin).toBeLessThanOrEqual(3);
  });

  test("multi-case run pays cache_write once and cache_read (N-1) times", () => {
    const e = estimateCost({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      transcripts: [SHORT, SHORT, SHORT, SHORT],
    });
    expect(e.cases).toBe(4);
    // 1 case writes the prefix, the remaining 3 read it.
    expect(e.usage.cache_write).toBe(e.prefix_tokens);
    expect(e.usage.cache_read).toBe(e.prefix_tokens * (e.cases - 1));
  });

  test("caching saves money vs no-cache fallback on a many-case run", () => {
    const e = estimateCost({
      strategy: "few_shot", // bigger prefix → bigger cache savings
      model: "claude-haiku-4-5-20251001",
      transcripts: Array.from({ length: 10 }, () => SHORT),
    });
    expect(e.cost_usd).toBeLessThan(e.cost_usd_no_cache);
    // We expect cache to give at least ~30% savings on a 10-case few-shot run.
    // If this regresses, either caching broke or the heuristic is off.
    expect(e.cost_usd / e.cost_usd_no_cache).toBeLessThan(0.7);
  });

  test("few_shot has a larger prefix than zero_shot (more tokens cached)", () => {
    const z = estimateCost({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      transcripts: [SHORT],
    });
    const f = estimateCost({
      strategy: "few_shot",
      model: "claude-haiku-4-5-20251001",
      transcripts: [SHORT],
    });
    expect(f.prefix_tokens).toBeGreaterThan(z.prefix_tokens);
  });

  test("Sonnet costs more than Haiku for the same workload (per pricing table)", () => {
    const haiku = estimateCost({
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      transcripts: [SHORT, SHORT, SHORT],
    });
    const sonnet = estimateCost({
      strategy: "zero_shot",
      model: "claude-sonnet-4-5-20250929",
      transcripts: [SHORT, SHORT, SHORT],
    });
    expect(sonnet.cost_usd).toBeGreaterThan(haiku.cost_usd);
  });
});
