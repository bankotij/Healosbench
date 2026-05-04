import type { Strategy, TokenUsage } from "@healosbench/shared";

import { costUsd } from "./pricing";
import { canonicalJSON } from "./hash";
import { getStrategy } from "./strategies/index";

/**
 * Heuristic chars-per-token used for the pre-flight cost estimator. Anthropic
 * tokenization is BPE-ish on English, ~3.7-4.0 chars/token; JSON is denser
 * (~3.0). We deliberately choose 3.5 — a middle estimate that errs slightly
 * conservative (over-estimate tokens → over-estimate cost → guardrail trips
 * a touch sooner). The estimator is a budget tool, not a forecast.
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * Average output tokens per case for `record_extraction` tool calls. This
 * comes from the Haiku 4.5 50-case runs we shipped:
 *   zero_shot ~315 tok/case · few_shot ~325 · cot ~470 (reasoning)
 * We pick 400 as a safe middle that over-estimates zero_shot/few_shot
 * slightly and roughly matches cot.
 */
const AVG_OUTPUT_TOKENS_PER_CASE = 400;

/**
 * Most cases land on attempt 1; a small minority retry. We bump output by
 * ~10% to stay conservative against the schema-retry path.
 */
const RETRY_OUTPUT_PADDING = 1.1;

function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function approxJsonTokens(value: unknown): number {
  return approxTokens(canonicalJSON(value));
}

export interface EstimateInput {
  strategy: Strategy;
  model: string;
  /**
   * Either pass actual transcripts (preferred — tightest estimate) or just a
   * count + an average length hint. The runner has the transcripts in hand
   * by the time it's about to start, so we always use the array path.
   */
  transcripts: ReadonlyArray<string>;
}

export interface EstimateBreakdown {
  prefix_tokens: number;
  per_case_input_tokens_avg: number;
  output_tokens_per_case: number;
  cases: number;
  // Token usage you'd expect to be billed for this whole run.
  usage: TokenUsage;
  cost_usd: number;
  // Same numbers but assuming caching is OFF (useful sanity check).
  cost_usd_no_cache: number;
}

/**
 * Estimate the cost of a full run for a given strategy/model/dataset slice.
 *
 * Cache model: the strategy-level prefix (system + tool + few-shot prefix
 * messages) is cache-controlled and stable across the run. Call #1 pays
 * `cache_write` for that prefix; calls #2..#N pay `cache_read` for it.
 * Each call still pays `input` for the case-specific transcript wrapper.
 */
export function estimateCost(input: EstimateInput): EstimateBreakdown {
  const strategy = getStrategy(input.strategy);
  const system = strategy.buildSystem();
  const prefix = strategy.buildPrefixMessages();

  const systemTokens = approxTokens(system);
  const toolTokens = approxJsonTokens(strategy.tool);
  const prefixMsgTokens = prefix.reduce(
    (acc, m) => acc + approxJsonTokens(m.content),
    0,
  );
  const prefixTokens = systemTokens + toolTokens + prefixMsgTokens;

  const cases = input.transcripts.length;
  const transcriptTokens = input.transcripts.reduce(
    (acc, t) => acc + approxTokens(t),
    0,
  );
  // Each user message wraps the transcript in a small frame ("Transcript:\n\n...")
  // — add ~6 tokens/case for that.
  const wrapTokens = cases * 6;

  const perCaseInputAvg =
    cases > 0 ? Math.round(transcriptTokens / cases) + 6 : 0;

  const outputTokens = Math.ceil(
    cases * AVG_OUTPUT_TOKENS_PER_CASE * RETRY_OUTPUT_PADDING,
  );

  // Cached path: 1× write, (N−1)× read on the prefix; transcripts are always
  // billed as input.
  const usage: TokenUsage = {
    input: transcriptTokens + wrapTokens,
    output: outputTokens,
    cache_write: cases > 0 ? prefixTokens : 0,
    cache_read: cases > 1 ? prefixTokens * (cases - 1) : 0,
  };
  const cost = costUsd(usage, input.model);

  // Same workload assuming caching is disabled — pay full input on prefix
  // every call. Useful as a sanity check / cache-savings figure.
  const usageNoCache: TokenUsage = {
    input: transcriptTokens + wrapTokens + prefixTokens * cases,
    output: outputTokens,
    cache_write: 0,
    cache_read: 0,
  };
  const costNoCache = costUsd(usageNoCache, input.model);

  return {
    prefix_tokens: prefixTokens,
    per_case_input_tokens_avg: perCaseInputAvg,
    output_tokens_per_case: Math.ceil(
      AVG_OUTPUT_TOKENS_PER_CASE * RETRY_OUTPUT_PADDING,
    ),
    cases,
    usage,
    cost_usd: cost,
    cost_usd_no_cache: costNoCache,
  };
}

/** Thrown when a run's projected cost exceeds the caller's `max_cost_usd`. */
export class CostExceedsCapError extends Error {
  readonly projected_cost_usd: number;
  readonly max_cost_usd: number;
  readonly breakdown: EstimateBreakdown;
  constructor(args: {
    projected_cost_usd: number;
    max_cost_usd: number;
    breakdown: EstimateBreakdown;
  }) {
    super(
      `Projected cost $${args.projected_cost_usd.toFixed(4)} exceeds cap $${args.max_cost_usd.toFixed(4)}`,
    );
    this.name = "CostExceedsCapError";
    this.projected_cost_usd = args.projected_cost_usd;
    this.max_cost_usd = args.max_cost_usd;
    this.breakdown = args.breakdown;
  }
}
