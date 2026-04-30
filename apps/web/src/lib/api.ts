"use client";

import { env } from "@test-evals/env/web";
import type { Extraction } from "@test-evals/shared/extraction";
import type {
  CaseEvaluation,
  CaseStatus,
  CreateRunRequest,
  FieldKey,
  LLMAttempt,
  RunStatus,
  RunStreamEvent,
  Strategy,
} from "@test-evals/shared/run";

/**
 * Typed fetch wrappers around the server eval API. We hand-mirror the response
 * shapes from `apps/server/src/services/runner.service.ts` rather than
 * importing the server module — that keeps the web bundle free of node-only
 * deps (drizzle, fs, etc).
 */

const BASE = env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "");

// ---------- list ------------------------------------------------------------

export interface RunListItem {
  id: string;
  strategy: Strategy;
  model: string;
  prompt_hash: string;
  status: RunStatus;
  dataset_filter: string[] | null;
  cases_total: number;
  cases_completed: number;
  cases_failed: number;
  schema_failures: number;
  hallucination_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost_usd: string; // numeric column → string in JSON
  wall_ms: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function listRuns(opts: { limit?: number } = {}): Promise<RunListItem[]> {
  const url = new URL("/api/v1/runs", BASE);
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`listRuns: ${res.status}`);
  const json = (await res.json()) as { runs: RunListItem[] };
  return json.runs;
}

// ---------- run summary -----------------------------------------------------

export interface RunSummaryResponse {
  run: RunListItem;
  per_field: Array<{ field: FieldKey; mean_score: number }>;
  overall_score: number | null;
}

export async function getRunSummary(runId: string): Promise<RunSummaryResponse | null> {
  const res = await fetch(`${BASE}/api/v1/runs/${runId}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRunSummary: ${res.status}`);
  return (await res.json()) as RunSummaryResponse;
}

// ---------- run cases -------------------------------------------------------

export interface RunCaseRow {
  id: string;
  run_id: string;
  case_id: string;
  status: CaseStatus;
  prediction: Extraction | null;
  scores: CaseEvaluation["scores"] | null;
  overall_score: string | null;
  hallucinated_fields: string[] | null;
  schema_invalid: boolean;
  attempts_count: number;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost_usd: string;
  wall_ms: number | null;
  error: string | null;
  cached_from_case_pk: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export async function getRunCases(runId: string): Promise<RunCaseRow[]> {
  const res = await fetch(`${BASE}/api/v1/runs/${runId}/cases`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getRunCases: ${res.status}`);
  const json = (await res.json()) as { cases: RunCaseRow[] };
  return json.cases;
}

// ---------- case detail (case row + LLM attempts) ---------------------------

export interface AttemptRow {
  id: string;
  case_pk: string;
  attempt_no: number;
  request_system: string;
  request_messages: LLMAttempt["request"]["messages"];
  request_tools: unknown;
  request_model: string;
  response_text: string | null;
  response_tool_input: unknown | null;
  stop_reason: string | null;
  validation_errors: Array<{ path: string; message: string; code: string }> | null;
  error: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  latency_ms: number;
  created_at: string;
}

export interface CaseDetailResponse {
  case: RunCaseRow;
  attempts: AttemptRow[];
  transcript: string | null;
  gold: Extraction | null;
}

export async function getCaseDetail(
  runId: string,
  caseId: string,
): Promise<CaseDetailResponse | null> {
  const res = await fetch(`${BASE}/api/v1/runs/${runId}/cases/${caseId}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getCaseDetail: ${res.status}`);
  return (await res.json()) as CaseDetailResponse;
}

// ---------- mutations -------------------------------------------------------

export interface CreateRunResponse {
  run_id: string;
  status: RunStatus;
  cases_total: number;
  prompt_hash: string;
}

export async function createRun(req: CreateRunRequest): Promise<CreateRunResponse> {
  const res = await fetch(`${BASE}/api/v1/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`createRun ${res.status}: ${txt}`);
  }
  return (await res.json()) as CreateRunResponse;
}

export async function pauseRun(runId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/runs/${runId}/pause`, { method: "POST" });
  if (!res.ok) throw new Error(`pauseRun: ${res.status}`);
}

export async function resumeRun(runId: string, force = false): Promise<void> {
  const url = new URL(`/api/v1/runs/${runId}/resume`, BASE);
  if (force) url.searchParams.set("force", "true");
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`resumeRun: ${res.status}`);
}

// ---------- SSE -------------------------------------------------------------

/**
 * Subscribe to an in-flight run's events. Returns an `unsubscribe` function.
 * Reconnects are handled by the browser (EventSource auto-retries on drop).
 */
export function subscribeToRun(
  runId: string,
  onEvent: (event: RunStreamEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = `${BASE}/api/v1/runs/${runId}/stream`;
  const es = new EventSource(url);
  es.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data) as RunStreamEvent;
      onEvent(ev);
    } catch {
      // ignore malformed (heartbeats are sent as a different event type)
    }
  };
  if (onError) es.onerror = onError;
  return () => es.close();
}
