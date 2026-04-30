import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { createDb } from "@test-evals/db";
import { attempts, cases, prompts, runs, type Run } from "@test-evals/db/schema/eval";
import { env } from "@test-evals/env/server";
import { evaluateCase } from "@test-evals/eval";
import {
  Semaphore,
  costUsd,
  getStrategy,
  promptHash as computePromptHash,
} from "@test-evals/llm";
import {
  ZERO_USAGE,
  addUsage,
  type CaseEvaluation,
  type CreateRunRequest,
  type DatasetCase,
  type FieldKey,
  type RunStatus,
  type Strategy,
  type TokenUsage,
  loadDataset,
} from "@test-evals/shared";

import { emitRunEvent } from "./run_events";
import { extractTranscript } from "./extract.service";

const RUN_CONCURRENCY = 5;

type Db = ReturnType<typeof createDb>;
let _db: Db | null = null;
function db(): Db {
  if (!_db) _db = createDb();
  return _db;
}

// Per-run semaphores — created on demand when a run starts.
const runSemaphores = new Map<string, Semaphore>();
// Per-run cancel flags — set when a graceful pause is requested.
const runCancelled = new Set<string>();

// ---------- public api -----------------------------------------------------

export interface CreateRunResult {
  run_id: string;
  status: RunStatus;
  cases_total: number;
  prompt_hash: string;
}

/**
 * Idempotently register the prompt for the chosen strategy, create a run
 * row, and seed one `cases` row per selected transcript. Does NOT start the
 * run — the caller must call `startRun` (or hit `POST /api/v1/runs/:id/resume`).
 */
export async function createRun(input: CreateRunRequest): Promise<CreateRunResult> {
  const strategyId = input.strategy;
  const strategy = getStrategy(strategyId);
  const model = input.model ?? env.DEFAULT_MODEL;
  const system = strategy.buildSystem();
  const tool = strategy.tool;
  const fewShot = strategy.hashExtras?.() ?? null;
  const promptHash = computePromptHash({
    strategy: strategyId,
    system,
    tool,
    few_shot: fewShot,
  });

  await ensurePromptRecorded({
    hash: promptHash,
    strategy: strategyId,
    system,
    tool,
    fewShot,
  });

  const dataset = await loadDataset({
    filter: input.dataset_filter ?? undefined,
  });
  if (dataset.length === 0) {
    throw new Error("Dataset is empty after applying filter");
  }

  const runId = randomUUID();
  await db().insert(runs).values({
    id: runId,
    strategy: strategyId,
    model,
    prompt_hash: promptHash,
    status: "pending",
    dataset_filter: input.dataset_filter ?? null,
    cases_total: dataset.length,
  });

  // Seed a case row per transcript so resumability is just a query.
  const caseRows = dataset.map((c) => ({
    id: randomUUID(),
    run_id: runId,
    case_id: c.id,
    status: "pending" as const,
  }));
  await db().insert(cases).values(caseRows);

  return {
    run_id: runId,
    status: "pending",
    cases_total: dataset.length,
    prompt_hash: promptHash,
  };
}

/**
 * Start (or resume) processing a run in the background. Returns immediately;
 * progress streams via run_events. Safe to call multiple times — only the
 * first kick-off does work; subsequent calls return the current status.
 */
export function startRun(runId: string, options: { force?: boolean } = {}): void {
  // Fire-and-forget background task. Errors are caught and surfaced via the
  // stream / DB row so the HTTP caller doesn't see them.
  void runRunBackground(runId, options.force ?? false).catch((err) => {
    console.error(`run ${runId} failed:`, err);
    void db()
      .update(runs)
      .set({
        status: "failed",
        finished_at: new Date(),
        error: err instanceof Error ? err.message : String(err),
      })
      .where(eq(runs.id, runId));
    emitRunEvent(runId, {
      type: "run_failed",
      run_id: runId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export function pauseRun(runId: string): void {
  runCancelled.add(runId);
}

export interface RunSummaryView {
  run: Run;
  per_field: Array<{ field: FieldKey; mean_score: number }>;
  /** Mean of case overall_scores (excluding cases that haven't completed). */
  overall_score: number | null;
}

export async function getRunSummary(runId: string): Promise<RunSummaryView | null> {
  const run = await db().query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) return null;
  const caseRows = await db().query.cases.findMany({ where: eq(cases.run_id, runId) });
  const completed = caseRows.filter((c) => c.status === "completed");

  const fieldSums = new Map<FieldKey, { sum: number; count: number }>();
  let overallSum = 0;
  let overallCount = 0;
  for (const c of completed) {
    if (c.overall_score === null) continue;
    overallSum += Number(c.overall_score);
    overallCount++;
    const scores = (c.scores as Array<{ field: FieldKey; score: number }>) ?? [];
    for (const s of scores) {
      const cur = fieldSums.get(s.field) ?? { sum: 0, count: 0 };
      cur.sum += s.score;
      cur.count++;
      fieldSums.set(s.field, cur);
    }
  }
  const per_field = Array.from(fieldSums.entries()).map(([field, { sum, count }]) => ({
    field,
    mean_score: count > 0 ? sum / count : 0,
  }));
  return {
    run,
    per_field,
    overall_score: overallCount > 0 ? overallSum / overallCount : null,
  };
}

export async function listRuns(limit = 50): Promise<Run[]> {
  return db().query.runs.findMany({ orderBy: [desc(runs.created_at)], limit });
}

export async function getRunCases(runId: string) {
  return db().query.cases.findMany({
    where: eq(cases.run_id, runId),
    orderBy: [asc(cases.case_id)],
  });
}

export async function getCaseDetail(runId: string, caseDatasetId: string) {
  const caseRow = await db().query.cases.findFirst({
    where: and(eq(cases.run_id, runId), eq(cases.case_id, caseDatasetId)),
  });
  if (!caseRow) return null;
  const attemptRows = await db().query.attempts.findMany({
    where: eq(attempts.case_pk, caseRow.id),
    orderBy: [asc(attempts.attempt_no)],
  });
  // The dashboard wants the transcript + gold inline for the diff view.
  // Loading just the one case is cheap and avoids a second round-trip.
  const [datasetCase] = await loadDataset({ filter: [caseDatasetId] });
  return {
    case: caseRow,
    attempts: attemptRows,
    transcript: datasetCase?.transcript ?? null,
    gold: datasetCase?.gold ?? null,
  };
}

// ---------- background processing ------------------------------------------

async function runRunBackground(runId: string, force: boolean): Promise<void> {
  const run = await db().query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status === "completed") return; // idempotent
  runCancelled.delete(runId);

  // Mark running.
  if (!run.started_at) {
    await db()
      .update(runs)
      .set({ status: "running", started_at: new Date(), error: null })
      .where(eq(runs.id, runId));
  } else if (run.status !== "running") {
    await db()
      .update(runs)
      .set({ status: "running", error: null })
      .where(eq(runs.id, runId));
  }

  const semaphore = ensureSemaphore(runId);
  const dataset = await loadDataset({
    filter: (run.dataset_filter as string[] | null) ?? undefined,
  });
  const datasetById = new Map(dataset.map((c) => [c.id, c]));

  // Pull all cases not yet completed. This is the resumability primitive —
  // resuming after a crash is just "find every non-completed case and run
  // it." Completed cases are left alone (no double-charging).
  const pending = await db().query.cases.findMany({
    where: and(eq(cases.run_id, runId), sql`${cases.status} != 'completed'`),
  });

  const t0 = performance.now();

  await Promise.all(
    pending.map((caseRow) =>
      semaphore.run(async () => {
        if (runCancelled.has(runId)) return;
        const ds = datasetById.get(caseRow.case_id);
        if (!ds) {
          await markCaseFailed(caseRow.id, runId, caseRow.case_id, `Case ${caseRow.case_id} not in dataset`);
          return;
        }
        await processCase({
          runId,
          caseRow,
          dataset: ds,
          run,
          force,
        });
      }),
    ),
  );

  const wallMs = Math.round(performance.now() - t0) + (run.wall_ms ?? 0);
  // Final summary.
  const finalCases = await db().query.cases.findMany({ where: eq(cases.run_id, runId) });
  const completedCount = finalCases.filter((c) => c.status === "completed").length;
  const failedCount = finalCases.filter((c) => c.status === "failed").length;
  const status: RunStatus = runCancelled.has(runId)
    ? "paused"
    : failedCount === 0 && completedCount === finalCases.length
      ? "completed"
      : completedCount === 0
        ? "failed"
        : "completed"; // partial is still completed; failed cases are visible per-row

  await db()
    .update(runs)
    .set({
      status,
      finished_at: status === "paused" ? null : new Date(),
      wall_ms: wallMs,
    })
    .where(eq(runs.id, runId));

  if (status === "paused") {
    emitRunEvent(runId, { type: "run_paused", run_id: runId });
  } else {
    const summary = await getRunSummary(runId);
    if (summary) {
      emitRunEvent(runId, {
        type: "run_completed",
        summary: {
          run_id: runId,
          strategy: summary.run.strategy as Strategy,
          model: summary.run.model,
          prompt_hash: summary.run.prompt_hash,
          status: summary.run.status as RunStatus,
          cases_total: summary.run.cases_total,
          cases_completed: summary.run.cases_completed,
          cases_failed: summary.run.cases_failed,
          schema_failures: summary.run.schema_failures,
          hallucination_count: summary.run.hallucination_count,
          per_field: summary.per_field,
          overall_score: summary.overall_score ?? 0,
          usage: {
            input: summary.run.tokens_input,
            output: summary.run.tokens_output,
            cache_read: summary.run.tokens_cache_read,
            cache_write: summary.run.tokens_cache_write,
          },
          cost_usd: Number(summary.run.cost_usd),
          wall_ms: summary.run.wall_ms,
          started_at: summary.run.started_at?.toISOString() ?? new Date().toISOString(),
          finished_at: summary.run.finished_at?.toISOString() ?? null,
        },
      });
    }
  }
}

async function processCase(args: {
  runId: string;
  caseRow: typeof cases.$inferSelect;
  dataset: DatasetCase;
  run: Run;
  force: boolean;
}): Promise<void> {
  const { runId, caseRow, dataset, run, force } = args;

  emitRunEvent(runId, { type: "case_started", case_id: caseRow.case_id });
  await db()
    .update(cases)
    .set({ status: "running", started_at: new Date(), error: null })
    .where(eq(cases.id, caseRow.id));

  const t0 = performance.now();

  // ---- Idempotency lookup --------------------------------------------------
  if (!force) {
    const cached = await findCachedCompletedCase({
      strategy: run.strategy as Strategy,
      model: run.model,
      promptHash: run.prompt_hash,
      datasetCaseId: caseRow.case_id,
    });
    if (cached) {
      const wall = Math.round(performance.now() - t0);
      await db()
        .update(cases)
        .set({
          status: "completed",
          prediction: cached.prediction,
          scores: cached.scores,
          overall_score: cached.overall_score,
          hallucinated_fields: cached.hallucinated_fields,
          schema_invalid: cached.schema_invalid,
          attempts_count: 0,
          // Idempotent reuse → no spend, no token usage on this case.
          tokens_input: 0,
          tokens_output: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          cost_usd: "0",
          wall_ms: wall,
          finished_at: new Date(),
          cached_from_case_pk: cached.case_pk,
        })
        .where(eq(cases.id, caseRow.id));
      await bumpRunCompletedCounters({ runId, schemaInvalid: cached.schema_invalid, hallucinated: cached.hallucinated_count });
      emitRunEvent(runId, {
        type: "case_completed",
        case_id: caseRow.case_id,
        eval: cached.evaluation,
        attempts: 0,
      });
      return;
    }
  }

  // ---- Live extract + evaluate --------------------------------------------
  try {
    const extractResult = await extractTranscript({
      transcript: dataset.transcript,
      strategy: run.strategy as Strategy,
      model: run.model,
    });

    const evaluation = evaluateCase({
      case_id: caseRow.case_id,
      prediction: extractResult.prediction,
      gold: dataset.gold,
      transcript: dataset.transcript,
      schemaInvalid: extractResult.schemaInvalid,
    });

    // Persist attempts.
    if (extractResult.attempts.length > 0) {
      await db().insert(attempts).values(
        extractResult.attempts.map((a) => ({
          id: randomUUID(),
          case_pk: caseRow.id,
          attempt_no: a.attempt,
          request_system: a.request.system,
          request_messages: a.request.messages,
          request_tools: a.request.tools,
          request_model: a.request.model,
          response_text: a.response.raw_text,
          response_tool_input: a.response.tool_input,
          stop_reason: a.response.stop_reason,
          validation_errors: a.validation_errors,
          error: a.error ?? null,
          tokens_input: a.usage.input,
          tokens_output: a.usage.output,
          tokens_cache_read: a.usage.cache_read,
          tokens_cache_write: a.usage.cache_write,
          latency_ms: a.latency_ms,
        })),
      );
    }

    const usage = extractResult.usage;
    const cost = costUsd(usage, run.model);
    const wall = Math.round(performance.now() - t0);

    await db()
      .update(cases)
      .set({
        status: "completed",
        prediction: extractResult.prediction,
        scores: evaluation.scores,
        overall_score: evaluation.overall_score.toFixed(4),
        hallucinated_fields: evaluation.hallucinated_fields,
        schema_invalid: evaluation.schema_invalid,
        attempts_count: extractResult.attempts.length,
        tokens_input: usage.input,
        tokens_output: usage.output,
        tokens_cache_read: usage.cache_read,
        tokens_cache_write: usage.cache_write,
        cost_usd: cost.toFixed(6),
        wall_ms: wall,
        finished_at: new Date(),
      })
      .where(eq(cases.id, caseRow.id));

    await bumpRunCounters({
      runId,
      usage,
      cost,
      schemaInvalid: evaluation.schema_invalid,
      hallucinated: evaluation.hallucinated_fields.length,
    });

    emitRunEvent(runId, {
      type: "case_completed",
      case_id: caseRow.case_id,
      eval: evaluation,
      attempts: extractResult.attempts.length,
    });
  } catch (err) {
    await markCaseFailed(
      caseRow.id,
      runId,
      caseRow.case_id,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------- helpers --------------------------------------------------------

function ensureSemaphore(runId: string): Semaphore {
  let s = runSemaphores.get(runId);
  if (!s) {
    s = new Semaphore(RUN_CONCURRENCY);
    runSemaphores.set(runId, s);
  }
  return s;
}

async function ensurePromptRecorded(p: {
  hash: string;
  strategy: Strategy;
  system: string;
  tool: unknown;
  fewShot: unknown;
}): Promise<void> {
  await db()
    .insert(prompts)
    .values({
      hash: p.hash,
      strategy: p.strategy,
      system_prompt: p.system,
      tool_definition: p.tool,
      few_shot_examples: p.fewShot,
    })
    .onConflictDoNothing();
}

interface CachedCase {
  case_pk: string;
  prediction: unknown;
  scores: unknown;
  overall_score: string | null;
  hallucinated_fields: string[];
  schema_invalid: boolean;
  hallucinated_count: number;
  evaluation: CaseEvaluation;
}

async function findCachedCompletedCase(args: {
  strategy: Strategy;
  model: string;
  promptHash: string;
  datasetCaseId: string;
}): Promise<CachedCase | null> {
  // Find any prior `cases` row, in any run with matching (strategy, model,
  // prompt_hash), that successfully completed for this transcript.
  const rows = await db()
    .select({
      id: cases.id,
      prediction: cases.prediction,
      scores: cases.scores,
      overall_score: cases.overall_score,
      hallucinated_fields: cases.hallucinated_fields,
      schema_invalid: cases.schema_invalid,
    })
    .from(cases)
    .innerJoin(runs, eq(cases.run_id, runs.id))
    .where(
      and(
        eq(cases.case_id, args.datasetCaseId),
        eq(cases.status, "completed"),
        eq(runs.strategy, args.strategy),
        eq(runs.model, args.model),
        eq(runs.prompt_hash, args.promptHash),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const hallucinated = (row.hallucinated_fields as string[] | null) ?? [];
  return {
    case_pk: row.id,
    prediction: row.prediction,
    scores: row.scores,
    overall_score: row.overall_score,
    hallucinated_fields: hallucinated,
    schema_invalid: row.schema_invalid,
    hallucinated_count: hallucinated.length,
    evaluation: {
      case_id: args.datasetCaseId,
      scores: (row.scores as CaseEvaluation["scores"]) ?? [],
      overall_score: row.overall_score ? Number(row.overall_score) : 0,
      hallucinated_fields: hallucinated,
      schema_invalid: row.schema_invalid,
    },
  };
}

async function bumpRunCounters(args: {
  runId: string;
  usage: TokenUsage;
  cost: number;
  schemaInvalid: boolean;
  hallucinated: number;
}): Promise<void> {
  await db()
    .update(runs)
    .set({
      cases_completed: sql`${runs.cases_completed} + 1`,
      schema_failures: sql`${runs.schema_failures} + ${args.schemaInvalid ? 1 : 0}`,
      hallucination_count: sql`${runs.hallucination_count} + ${args.hallucinated}`,
      tokens_input: sql`${runs.tokens_input} + ${args.usage.input}`,
      tokens_output: sql`${runs.tokens_output} + ${args.usage.output}`,
      tokens_cache_read: sql`${runs.tokens_cache_read} + ${args.usage.cache_read}`,
      tokens_cache_write: sql`${runs.tokens_cache_write} + ${args.usage.cache_write}`,
      cost_usd: sql`${runs.cost_usd} + ${args.cost.toFixed(6)}`,
    })
    .where(eq(runs.id, args.runId));
}

async function bumpRunCompletedCounters(args: {
  runId: string;
  schemaInvalid: boolean;
  hallucinated: number;
}): Promise<void> {
  await bumpRunCounters({
    runId: args.runId,
    usage: ZERO_USAGE,
    cost: 0,
    schemaInvalid: args.schemaInvalid,
    hallucinated: args.hallucinated,
  });
}

async function markCaseFailed(
  casePk: string,
  runId: string,
  datasetCaseId: string,
  errorMessage: string,
): Promise<void> {
  await db()
    .update(cases)
    .set({
      status: "failed",
      error: errorMessage,
      finished_at: new Date(),
    })
    .where(eq(cases.id, casePk));
  await db()
    .update(runs)
    .set({ cases_failed: sql`${runs.cases_failed} + 1` })
    .where(eq(runs.id, runId));
  emitRunEvent(runId, {
    type: "case_failed",
    case_id: datasetCaseId,
    error: errorMessage,
  });
}

// `addUsage` is exported indirectly (used by the CLI to aggregate).
export { addUsage };

// ---------- active-learning: disagreement across runs ----------------------
//
// "Surface the cases most worth annotating better" — concretely, the cases
// where two or more runs disagree most about the right answer. Those are the
// cases where one prompt found something another missed, or where the gold is
// ambiguous and the metric is rewarding paraphrase. Either way they're the
// highest-information cases for a human reviewer.

export interface DisagreementContributor {
  run_id: string;
  strategy: Strategy;
  model: string;
  prompt_hash: string;
  overall_score: number;
}

export interface DisagreementRow {
  case_id: string;
  spread: number; // max - min across contributing runs
  mean_score: number;
  contributors: DisagreementContributor[];
}

export async function listDisagreements(opts: {
  limit?: number;
  model?: string | null;
  strategy?: Strategy | null;
} = {}): Promise<DisagreementRow[]> {
  const limit = opts.limit ?? 5;

  const filters = [eq(cases.status, "completed")];
  if (opts.model) filters.push(eq(runs.model, opts.model));
  if (opts.strategy) filters.push(eq(runs.strategy, opts.strategy));

  const rows = await db()
    .select({
      case_id: cases.case_id,
      overall_score: cases.overall_score,
      run_id: runs.id,
      strategy: runs.strategy,
      model: runs.model,
      prompt_hash: runs.prompt_hash,
    })
    .from(cases)
    .innerJoin(runs, eq(cases.run_id, runs.id))
    .where(and(...filters));

  const grouped = new Map<string, DisagreementContributor[]>();
  for (const r of rows) {
    if (r.overall_score === null) continue;
    const score = Number(r.overall_score);
    // De-dupe identical (run_id) entries (shouldn't happen, defensive).
    const list = grouped.get(r.case_id) ?? [];
    list.push({
      run_id: r.run_id,
      strategy: r.strategy as Strategy,
      model: r.model,
      prompt_hash: r.prompt_hash,
      overall_score: score,
    });
    grouped.set(r.case_id, list);
  }

  const out: DisagreementRow[] = [];
  for (const [caseId, contributors] of grouped) {
    // Need at least two *distinct* prompt_hashes — comparing a run to itself
    // (same prompt re-run) isn't disagreement, that's just noise / cache hits.
    const distinctPrompts = new Set(contributors.map((c) => c.prompt_hash));
    if (distinctPrompts.size < 2) continue;
    const scores = contributors.map((c) => c.overall_score);
    const spread = Math.max(...scores) - Math.min(...scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    out.push({
      case_id: caseId,
      spread,
      mean_score: mean,
      contributors: contributors.sort((a, b) => b.overall_score - a.overall_score),
    });
  }

  out.sort((a, b) => b.spread - a.spread);
  return out.slice(0, limit);
}
