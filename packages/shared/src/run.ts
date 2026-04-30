import { z } from "zod";

import { ExtractionSchema, FIELD_KEYS, type FieldKey } from "./extraction";

export const STRATEGIES = ["zero_shot", "few_shot", "cot"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const StrategySchema = z.enum(STRATEGIES);

export const RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "paused",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CASE_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

// ---------- Tokens / cost ---------------------------------------------------

export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export const ZERO_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
  };
}

// ---------- Per-attempt LLM trace ------------------------------------------

export interface LLMAttempt {
  attempt: number; // 1-based
  request: {
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: unknown }>;
    tools?: unknown;
    model: string;
  };
  response: {
    raw_text: string | null;
    tool_input: unknown | null;
    stop_reason: string | null;
  };
  usage: TokenUsage;
  latency_ms: number;
  validation_errors: Array<{ path: string; message: string; code: string }> | null;
  error?: string | null;
}

// ---------- Per-field scores ------------------------------------------------

export const FieldScoreSchema = z.object({
  field: z.enum(FIELD_KEYS),
  score: z.number().min(0).max(1),
  // Optional richer breakdown depending on the metric used. Set-based fields
  // populate precision/recall/f1; numeric/exact fields just populate score.
  precision: z.number().min(0).max(1).nullable().optional(),
  recall: z.number().min(0).max(1).nullable().optional(),
  f1: z.number().min(0).max(1).nullable().optional(),
  details: z.unknown().optional(),
});
export type FieldScore = z.infer<typeof FieldScoreSchema>;

export interface CaseEvaluation {
  case_id: string;
  scores: FieldScore[];
  /** Macro-average across all fields' main `score`. */
  overall_score: number;
  /** Predicted values that don't appear (fuzzily) in the transcript. */
  hallucinated_fields: string[];
  /** True if the final prediction failed schema validation after all retries. */
  schema_invalid: boolean;
}

// ---------- Run-level aggregates -------------------------------------------

export interface FieldAggregate {
  field: FieldKey;
  mean_score: number;
  mean_precision?: number | null;
  mean_recall?: number | null;
  mean_f1?: number | null;
}

export interface RunSummary {
  run_id: string;
  strategy: Strategy;
  model: string;
  prompt_hash: string;
  status: RunStatus;
  cases_total: number;
  cases_completed: number;
  cases_failed: number;
  schema_failures: number;
  hallucination_count: number;
  per_field: FieldAggregate[];
  /** Overall macro-F1-ish: mean of per-case overall_score. */
  overall_score: number;
  usage: TokenUsage;
  cost_usd: number;
  wall_ms: number;
  started_at: string; // ISO
  finished_at: string | null; // ISO or null
}

// ---------- API request / response shapes ----------------------------------

export const CreateRunRequestSchema = z.object({
  strategy: StrategySchema,
  model: z.string().min(1).optional(),
  /** Optional case-id whitelist to run a subset of the dataset. */
  dataset_filter: z.array(z.string().min(1)).optional(),
  /** If true, bypass idempotency cache and force re-execution. */
  force: z.boolean().optional(),
  /**
   * Cost guardrail: if set, the server pre-flight-estimates the run and
   * refuses to start if `projected_cost_usd > max_cost_usd`. Set to a
   * generous number to effectively disable. Best practice: set this on every
   * production-style run so a configuration mistake (Opus + force=true on
   * the full set) can't quietly burn through your budget.
   */
  max_cost_usd: z.number().positive().optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

// SSE event payloads streamed from `GET /api/v1/runs/:id/stream`.
export type RunStreamEvent =
  | { type: "case_started"; case_id: string }
  | {
      type: "case_completed";
      case_id: string;
      eval: CaseEvaluation;
      attempts: number;
    }
  | { type: "case_failed"; case_id: string; error: string }
  | { type: "run_completed"; summary: RunSummary }
  | { type: "run_paused"; run_id: string }
  | { type: "run_failed"; run_id: string; error: string };

export { FIELD_KEYS, type FieldKey };
export { ExtractionSchema };
