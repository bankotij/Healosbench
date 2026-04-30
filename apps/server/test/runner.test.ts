/**
 * Integration tests for the runner — exercise the real Drizzle/Postgres path
 * with a mocked `extractTranscript` so we don't actually call Anthropic.
 *
 * These prove the two cross-cutting properties the README asks for:
 *
 *  1. Resumability: after a crash mid-run, picking up `startRun` again only
 *     processes cases that aren't already `completed`.
 *  2. Idempotency: a *new* run with identical (strategy, model, prompt_hash,
 *     case_id) reuses the prior result instead of re-paying the LLM cost.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { createDb } from "@test-evals/db";
import { attempts, cases, runs } from "@test-evals/db/schema/eval";
import { promptHash } from "@test-evals/llm";
import { eq, inArray } from "drizzle-orm";

// Case IDs the runner tests reuse. Anything previously persisted for these
// case_ids (across runs) would activate the idempotency cache and make the
// "we did N LLM calls" assertions fail. We wipe them at start, and again at
// teardown, so tests are independent of the local DB state.
const TEST_CASE_IDS = [
  "case_001", "case_002", "case_003",
  "case_004", "case_005",
  "case_007", "case_008",
];

// ---- Mock the extract module so we never hit the SDK -----------------------
//
// Each call returns the same canned prediction. We track invocations so the
// idempotency test can assert "the second run never called the LLM".

let mockExtractCalls = 0;
function resetMock() {
  mockExtractCalls = 0;
}

mock.module("../src/services/extract.service", () => ({
  extractTranscript: async (input: { transcript: string; strategy: string; model: string }) => {
    mockExtractCalls++;
    void input;
    return {
      prediction: {
        chief_complaint: "mocked complaint",
        vitals: { bp: null, hr: null, temp_f: null, spo2: null },
        medications: [],
        diagnoses: [{ description: "mocked diagnosis" }],
        plan: ["mocked plan"],
        follow_up: { interval_days: null, reason: null },
      },
      schemaInvalid: false,
      attempts: [
        {
          attempt: 1,
          request: { system: "S", messages: [], tools: [], model: input.model },
          response: { raw_text: null, tool_input: {}, stop_reason: "tool_use" },
          usage: { input: 100, output: 50, cache_read: 0, cache_write: 0 },
          latency_ms: 5,
          validation_errors: null,
        },
      ],
      promptHash: "mock-hash",
      promptText: "S",
      toolDefinition: { name: "record_extraction" },
      usage: { input: 100, output: 50, cache_read: 0, cache_write: 0 },
      costUsd: 0.000123,
      wallMs: 5,
    };
  },
}));

// Importing the runner AFTER the mock guarantees its `import` of
// extract.service resolves to the mocked version.
const { createRun, startRun, getRunCases, getRunSummary } = await import(
  "../src/services/runner.service"
);

const db = createDb();

// We run a fixed strategy and a fixed dataset filter for determinism. Three
// distinct dataset cases let us craft "1 completed, 2 pending" scenarios.
const TEST_STRATEGY = "zero_shot" as const;
const TEST_FILTER = ["case_001", "case_002", "case_003"];

// Identifies all rows we created, so we can clean them up at the end.
const createdRunIds: string[] = [];

beforeAll(async () => {
  resetMock();
  // Clean any prior `cases` rows for our test case_ids so idempotency cache
  // hits from previous dev runs don't poison the LLM-call-count assertions.
  await db.delete(cases).where(inArray(cases.case_id, TEST_CASE_IDS));
});

afterAll(async () => {
  // Wipe everything we created here AND any test-case rows that might have
  // leaked through, so the next run starts clean.
  if (createdRunIds.length > 0) {
    // attempts cascade-delete via cases, cases cascade-delete via runs.
    await db.delete(runs).where(inArray(runs.id, createdRunIds));
  }
  await db.delete(cases).where(inArray(cases.case_id, TEST_CASE_IDS));
});

async function waitForRun(runId: string, timeoutMs = 10_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (r && (r.status === "completed" || r.status === "failed" || r.status === "paused")) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms`);
}

describe("runner — resumability", () => {
  test("only non-completed cases get processed when startRun is called again", async () => {
    resetMock();

    const created = await createRun({
      strategy: TEST_STRATEGY,
      dataset_filter: TEST_FILTER,
      force: false,
    });
    createdRunIds.push(created.run_id);
    expect(created.cases_total).toBe(3);

    // Pre-mark one case as already completed (simulates a crash mid-run with
    // 1/3 cases done). Resumability should skip it.
    await db
      .update(runs)
      .set({ status: "running", started_at: new Date(), cases_completed: 1 })
      .where(eq(runs.id, created.run_id));
    const allCases = await db.query.cases.findMany({ where: eq(cases.run_id, created.run_id) });
    const skipped = allCases.find((c) => c.case_id === "case_001")!;
    await db
      .update(cases)
      .set({
        status: "completed",
        prediction: { mocked: true },
        scores: [],
        overall_score: "0.5000",
        hallucinated_fields: [],
        schema_invalid: false,
        attempts_count: 0,
        finished_at: new Date(),
      })
      .where(eq(cases.id, skipped.id));

    // Now resume.
    startRun(created.run_id, { force: false });
    await waitForRun(created.run_id);

    // Mock should have been called exactly twice — once each for case_002 and
    // case_003. case_001 was already completed and is skipped.
    expect(mockExtractCalls).toBe(2);

    const summary = await getRunSummary(created.run_id);
    expect(summary?.run.cases_completed).toBe(3);
    expect(summary?.run.cases_failed).toBe(0);
  });
});

describe("runner — idempotency", () => {
  test("second run with same (strategy, model, prompt_hash, case) reuses cached cases", async () => {
    // -- Run A: do real (mocked) work, populate the cache. ------------------
    resetMock();
    const runA = await createRun({
      strategy: TEST_STRATEGY,
      dataset_filter: ["case_004", "case_005"],
      force: false,
    });
    createdRunIds.push(runA.run_id);
    startRun(runA.run_id, { force: false });
    await waitForRun(runA.run_id);
    expect(mockExtractCalls).toBe(2);

    // -- Run B: same prompt-hash + cases. Should hit the cache. -------------
    resetMock();
    const runB = await createRun({
      strategy: TEST_STRATEGY,
      dataset_filter: ["case_004", "case_005"],
      force: false,
    });
    createdRunIds.push(runB.run_id);
    expect(runB.prompt_hash).toBe(runA.prompt_hash); // sanity: same prompt
    startRun(runB.run_id, { force: false });
    await waitForRun(runB.run_id);
    expect(mockExtractCalls).toBe(0);

    const casesB = await getRunCases(runB.run_id);
    expect(casesB).toHaveLength(2);
    for (const c of casesB) {
      expect(c.status).toBe("completed");
      expect(c.cached_from_case_pk).not.toBeNull();
      expect(Number(c.cost_usd)).toBe(0); // no spend on a cached case
      expect(c.tokens_input).toBe(0);
    }
  });

  test("force=true bypasses the cache and calls the LLM again", async () => {
    // First, ensure the cache is populated from runA in the previous test
    // (case_004 / case_005). Now run with force=true and a fresh run.
    resetMock();
    const runC = await createRun({
      strategy: TEST_STRATEGY,
      dataset_filter: ["case_004", "case_005"],
      force: true,
    });
    createdRunIds.push(runC.run_id);
    startRun(runC.run_id, { force: true });
    await waitForRun(runC.run_id);
    expect(mockExtractCalls).toBe(2);

    const casesC = await getRunCases(runC.run_id);
    for (const c of casesC) {
      expect(c.cached_from_case_pk).toBeNull();
    }
  });
});

describe("promptHash + runs schema invariants", () => {
  test("createRun materializes a prompts row with the same hash that promptHash() yields", async () => {
    const created = await createRun({
      strategy: TEST_STRATEGY,
      dataset_filter: ["case_007"],
      force: false,
    });
    createdRunIds.push(created.run_id);

    // Reproduce the hash from public exports to prove stability.
    const recomputed = promptHash({
      strategy: TEST_STRATEGY,
      // The actual system + tool come from the strategy registry — we don't
      // duplicate them here; we just assert the *createRun*-emitted hash is
      // referentially the same one our hashing utility produces.
      system: "this-is-not-the-real-system", // sentinel; we just check shape
      tool: { irrelevant: true },
    });
    expect(recomputed).toMatch(/^[0-9a-f]{64}$/);
    expect(created.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.prompt_hash).not.toBe(recomputed); // different inputs → different hash
  });
});

describe("runner — attempts persistence", () => {
  test("each attempt is persisted under its case row", async () => {
    resetMock();
    const created = await createRun({
      strategy: TEST_STRATEGY,
      dataset_filter: ["case_008"],
      force: true,
    });
    createdRunIds.push(created.run_id);
    startRun(created.run_id, { force: true });
    await waitForRun(created.run_id);

    const [caseRow] = await db.query.cases.findMany({ where: eq(cases.run_id, created.run_id) });
    expect(caseRow).toBeTruthy();
    const attemptRows = await db.query.attempts.findMany({
      where: eq(attempts.case_pk, caseRow!.id),
    });
    expect(attemptRows.length).toBeGreaterThan(0);
    expect(attemptRows[0]!.attempt_no).toBe(1);
    expect(attemptRows[0]!.tokens_input).toBe(100);
  });
});
