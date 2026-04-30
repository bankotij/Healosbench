import type { TokenUsage } from "@test-evals/shared";

// Per-million-token rates in USD.
// Source: https://docs.anthropic.com/en/docs/about-claude/pricing
// We default to 5-minute cache writes — that's what we use everywhere.
export interface ModelPricing {
  input: number;
  output: number;
  cache_write_5m: number;
  cache_read: number;
}

const PRICING_PER_MTOK: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cache_write_5m: 1.25,
    cache_read: 0.1,
  },
  "claude-sonnet-4-5-20250929": {
    input: 3,
    output: 15,
    cache_write_5m: 3.75,
    cache_read: 0.3,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cache_write_5m: 3.75,
    cache_read: 0.3,
  },
  "claude-opus-4-5": {
    input: 5,
    output: 25,
    cache_write_5m: 6.25,
    cache_read: 0.5,
  },
};

const FALLBACK: ModelPricing = PRICING_PER_MTOK["claude-haiku-4-5-20251001"]!;

export function pricingFor(model: string): ModelPricing {
  // Match longest known prefix so date-suffixed model IDs work.
  const exact = PRICING_PER_MTOK[model];
  if (exact) return exact;
  for (const [key, value] of Object.entries(PRICING_PER_MTOK)) {
    if (model.startsWith(key.replace(/-\d{8}$/, ""))) return value;
  }
  return FALLBACK;
}

/**
 * Convert raw token usage to USD. Cache-read tokens are billed at 0.1× input,
 * cache-write at 1.25× input — these are already accounted for in the table.
 */
export function costUsd(usage: TokenUsage, model: string): number {
  const p = pricingFor(model);
  const M = 1_000_000;
  return (
    (usage.input * p.input) / M +
    (usage.output * p.output) / M +
    (usage.cache_write * p.cache_write_5m) / M +
    (usage.cache_read * p.cache_read) / M
  );
}
