#!/usr/bin/env bun
/**
 * CLI eval runner. Drives a full N-case run end-to-end, persists results to
 * Postgres (so the dashboard sees them), and prints a summary table.
 *
 * Usage:
 *   bun run eval -- --strategy=zero_shot
 *   bun run eval -- --strategy=cot --model=claude-haiku-4-5-20251001
 *   bun run eval -- --strategy=few_shot --filter=case_001,case_002
 *   bun run eval -- --strategy=zero_shot --force            # bypass idempotency cache
 *
 * Designed to be safe in CI: exits 0 only when every case completed
 * successfully (no schema_failures past the retry loop, no failed cases).
 */

import { CostExceedsCapError } from "@healosbench/llm";
import { STRATEGIES, type Strategy } from "@healosbench/shared";

import {
  createRun,
  estimateRun,
  getRunCases,
  getRunSummary,
  startRun,
} from "../services/runner.service";
import { subscribeToRun } from "../services/run_events";

interface CliArgs {
  strategy: Strategy;
  model?: string;
  filter?: string[];
  force: boolean;
  maxCost?: number;
  estimateOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = { force: false, estimateOnly: false };
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [key, value] = raw.slice(2).split("=", 2);
    switch (key) {
      case "strategy":
        if (!value || !STRATEGIES.includes(value as Strategy)) {
          die(`--strategy must be one of: ${STRATEGIES.join(", ")}`);
        }
        args.strategy = value as Strategy;
        break;
      case "model":
        if (!value) die("--model needs a value");
        args.model = value;
        break;
      case "filter":
        if (!value) die("--filter needs a value");
        args.filter = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "force":
        args.force = true;
        break;
      case "max-cost": {
        if (!value) die("--max-cost needs a value (USD)");
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) die(`--max-cost must be a positive number, got ${value}`);
        args.maxCost = n;
        break;
      }
      case "estimate":
      case "dry-run":
        args.estimateOnly = true;
        break;
      case "help":
      case "h":
        printHelp();
        process.exit(0);
      default:
        die(`unknown flag: --${key}`);
    }
  }
  if (!args.strategy) die("--strategy is required");
  return args as CliArgs;
}

function printHelp(): void {
  process.stdout.write(`Usage: bun run eval -- [options]

Options:
  --strategy=<id>         Required. One of: ${STRATEGIES.join(", ")}
  --model=<name>          Override DEFAULT_MODEL (e.g. claude-haiku-4-5-20251001)
  --filter=<id,id,...>    Restrict to specific case ids (comma-separated)
  --force                 Bypass idempotency cache; re-run every case
  --max-cost=<usd>        Cost guardrail. Refuse to start if projected
                          cost > N. Estimate is pre-flight (no LLM call).
  --estimate, --dry-run   Print the cost estimate and exit (no LLM calls,
                          no DB writes).
  --help, -h              This help text
`);
}

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`▸ Strategy: ${args.strategy}\n`);
  if (args.model) process.stdout.write(`▸ Model: ${args.model}\n`);
  if (args.filter) process.stdout.write(`▸ Filter: ${args.filter.length} cases\n`);
  if (args.force) process.stdout.write(`▸ Force: bypassing idempotency cache\n`);
  if (args.maxCost != null) process.stdout.write(`▸ Cost cap: $${args.maxCost.toFixed(4)}\n`);

  // Pre-flight estimate. Always print it; if --estimate, exit here.
  const estimate = await estimateRun({
    strategy: args.strategy,
    model: args.model ?? null,
    dataset_filter: args.filter ?? null,
  });
  const b = estimate.breakdown;
  process.stdout.write(
    `▸ Estimate: ${b.cases} case(s) · ~${fmt(b.usage.input)}+${fmt(b.usage.cache_read)}+${fmt(b.usage.cache_write)} in · ~${fmt(b.usage.output)} out · projected $${b.cost_usd.toFixed(4)} (no-cache: $${b.cost_usd_no_cache.toFixed(4)})\n`,
  );
  if (args.estimateOnly) {
    process.stdout.write("\n(--estimate set, exiting before any LLM calls)\n");
    process.exit(0);
  }

  let run;
  try {
    run = await createRun({
      strategy: args.strategy,
      model: args.model,
      dataset_filter: args.filter,
      force: args.force,
      max_cost_usd: args.maxCost,
    });
  } catch (err) {
    if (err instanceof CostExceedsCapError) {
      process.stderr.write(
        `\nrefusing to start: projected cost $${err.projected_cost_usd.toFixed(4)} exceeds cap $${err.max_cost_usd.toFixed(4)}\n`,
      );
      process.stderr.write(`(re-run without --max-cost or raise the cap)\n`);
      process.exit(3);
    }
    throw err;
  }
  process.stdout.write(`▸ Run ID: ${run.run_id}\n`);
  process.stdout.write(`▸ Prompt hash: ${run.prompt_hash.slice(0, 12)}\n`);
  process.stdout.write(`▸ Cases: ${run.cases_total}\n\n`);

  // Live progress via the in-process pub-sub.
  let completed = 0;
  let failed = 0;
  const total = run.cases_total;
  const t0 = performance.now();

  const stop = waitForRun(run.run_id, ({ status, scoreSum }) => {
    if (status === "completed") completed++;
    if (status === "failed") failed++;
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    const meanScore = completed > 0 ? (scoreSum / completed).toFixed(3) : "—";
    process.stdout.write(
      `\r  ${pad((completed + failed).toString(), 3)}/${total}  done  · ${pad(failed.toString(), 2)} failed  · mean=${meanScore}  · ${elapsed}s   `,
    );
  });

  startRun(run.run_id, { force: args.force });
  await stop;
  process.stdout.write("\n\n");

  await printSummary(run.run_id);

  // Exit code: 0 if everything completed cleanly, 1 otherwise.
  const summary = await getRunSummary(run.run_id);
  if (!summary) process.exit(1);
  if (summary.run.cases_failed > 0) process.exit(1);
  if (summary.run.schema_failures > 0) process.exit(1);
  process.exit(0);
}

interface ProgressTick {
  status: "completed" | "failed";
  scoreSum: number;
}

function waitForRun(
  runId: string,
  onTick: (info: ProgressTick) => void,
): Promise<void> {
  let scoreSum = 0;
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeToRun(runId, (event) => {
      if (event.type === "case_completed") {
        scoreSum += event.eval.overall_score;
        onTick({ status: "completed", scoreSum });
      } else if (event.type === "case_failed") {
        onTick({ status: "failed", scoreSum });
      } else if (
        event.type === "run_completed" ||
        event.type === "run_failed" ||
        event.type === "run_paused"
      ) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function printSummary(runId: string): Promise<void> {
  const summary = await getRunSummary(runId);
  if (!summary) {
    process.stderr.write("Run not found.\n");
    return;
  }
  const r = summary.run;
  const overall = summary.overall_score ?? 0;

  const cases = await getRunCases(runId);
  const cached = cases.filter((c) => c.cached_from_case_pk).length;
  const halluc = cases.reduce(
    (n, c) => n + ((c.hallucinated_fields as string[] | null)?.length ?? 0),
    0,
  );

  process.stdout.write(`Strategy:      ${r.strategy}\n`);
  process.stdout.write(`Model:         ${r.model}\n`);
  process.stdout.write(`Prompt hash:   ${r.prompt_hash}\n`);
  process.stdout.write(
    `Cases:         ${r.cases_completed}/${r.cases_total} completed (${r.cases_failed} failed, ${r.schema_failures} schema-invalid, ${cached} cached)\n`,
  );
  process.stdout.write(
    `Tokens:        ${fmt(r.tokens_input)} in · ${fmt(r.tokens_output)} out · ${fmt(r.tokens_cache_read)} cache_read · ${fmt(r.tokens_cache_write)} cache_write\n`,
  );
  process.stdout.write(`Cost:          $${Number(r.cost_usd).toFixed(4)}\n`);
  process.stdout.write(`Wall:          ${(r.wall_ms / 1000).toFixed(1)}s\n`);
  process.stdout.write(`Hallucinated:  ${halluc} flagged values across ${cases.filter((c) => ((c.hallucinated_fields as string[] | null) ?? []).length > 0).length} cases\n`);
  process.stdout.write("\n");

  process.stdout.write("Per-field scores:\n");
  process.stdout.write(`  ${pad("Field", 18)}  ${pad("Mean Score", 12)}\n`);
  process.stdout.write(`  ${"-".repeat(18)}  ${"-".repeat(12)}\n`);
  for (const f of summary.per_field) {
    process.stdout.write(`  ${pad(f.field, 18)}  ${pad(f.mean_score.toFixed(4), 12)}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write(`Overall:       ${overall.toFixed(4)}\n`);
}

function fmt(n: number | string): string {
  return Number(n).toLocaleString();
}

function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  if (s.length >= width) return s;
  return align === "left" ? s.padEnd(width) : s.padStart(width);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
