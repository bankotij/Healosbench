"use client";

import { Button } from "@healosbench/ui/components/button";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  CostCapError,
  createRun,
  estimateRun,
  type RunEstimate,
} from "@/lib/api";
import { fmtCost, fmtTokens } from "@/lib/format";
import type { Strategy } from "@healosbench/shared/run";

const STRATEGIES: ReadonlyArray<{ id: Strategy; label: string; hint: string }> = [
  {
    id: "zero_shot",
    label: "Zero-shot",
    hint: "Schema + safety rules + tool — fastest, lowest tokens.",
  },
  {
    id: "few_shot",
    label: "Few-shot",
    hint: "Three worked examples in the cached prefix. Best accuracy / cost.",
  },
  {
    id: "cot",
    label: "Chain-of-thought",
    hint: "Reason step-by-step before calling the tool. Higher latency.",
  },
];

export function NewRunForm({ onCreated }: { onCreated?: (runId: string) => void }) {
  const [strategy, setStrategy] = useState<Strategy>("few_shot");
  const [filter, setFilter] = useState<string>("");
  const [force, setForce] = useState<boolean>(false);
  const [maxCost, setMaxCost] = useState<string>("");
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Live cost estimate. Debounced ~250ms so we don't hammer the server while
  // the user types case ids.
  useEffect(() => {
    let alive = true;
    const cases = filter
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const handle = setTimeout(() => {
      estimateRun({
        strategy,
        dataset_filter: cases.length > 0 ? cases : undefined,
      })
        .then((r) => {
          if (!alive) return;
          setEstimate(r);
          setEstimateError(null);
        })
        .catch((e) => {
          if (!alive) return;
          setEstimate(null);
          setEstimateError(e instanceof Error ? e.message : String(e));
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [strategy, filter]);

  function submit() {
    const cases = filter
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const cap = maxCost.trim();
    const parsedCap = cap ? Number(cap) : null;
    if (cap && (parsedCap === null || !Number.isFinite(parsedCap) || parsedCap <= 0)) {
      toast.error(`Invalid cost cap: ${cap}`);
      return;
    }
    startTransition(async () => {
      try {
        const res = await createRun({
          strategy,
          dataset_filter: cases.length > 0 ? cases : undefined,
          force,
          max_cost_usd: parsedCap ?? undefined,
        });
        toast.success(`Run created (${res.cases_total} cases)`);
        onCreated?.(res.run_id);
        router.push(`/runs/${res.run_id}`);
      } catch (err) {
        if (err instanceof CostCapError) {
          toast.error(
            `Cost guardrail tripped: projected ${fmtCost(err.projected_cost_usd)} > cap ${fmtCost(err.max_cost_usd)}`,
          );
        } else {
          toast.error(err instanceof Error ? err.message : "Failed to create run");
        }
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Start a new evaluation run</h3>
        <p className="text-xs text-muted-foreground">
          Each run executes the chosen strategy against the dataset (or a filtered
          subset) on Claude Haiku 4.5. Repeat runs reuse cached cases by default.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground mb-1">Strategy</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {STRATEGIES.map((s) => (
            <label
              key={s.id}
              className={`cursor-pointer rounded-md border p-3 text-sm transition-colors ${
                strategy === s.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <input
                type="radio"
                name="strategy"
                value={s.id}
                checked={strategy === s.id}
                onChange={() => setStrategy(s.id)}
                className="sr-only"
              />
              <div className="font-medium">{s.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.hint}</div>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="filter" className="text-xs font-medium text-muted-foreground mb-1 block">
          Case filter (comma-separated IDs, optional)
        </label>
        <input
          id="filter"
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="e.g. case_001, case_002 — leave blank to run all 50"
          className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm outline-none focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          <span>Force re-run (bypass idempotency cache)</span>
        </label>
        <div>
          <label
            htmlFor="max-cost"
            className="text-xs font-medium text-muted-foreground mb-1 block"
          >
            Max cost (USD, optional cap)
          </label>
          <input
            id="max-cost"
            type="number"
            min="0"
            step="0.01"
            value={maxCost}
            onChange={(e) => setMaxCost(e.target.value)}
            placeholder="e.g. 0.25 — refuse if estimate exceeds"
            className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      <EstimatePanel estimate={estimate} error={estimateError} maxCost={maxCost} />

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Creating…" : "Start run"}
        </Button>
      </div>
    </div>
  );
}

function EstimatePanel({
  estimate,
  error,
  maxCost,
}: {
  estimate: RunEstimate | null;
  error: string | null;
  maxCost: string;
}) {
  if (error) {
    return (
      <div className="rounded-md border bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700">
        Estimate failed: {error}
      </div>
    );
  }
  if (!estimate) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Estimating…
      </div>
    );
  }
  const b = estimate.breakdown;
  const cap = maxCost.trim() ? Number(maxCost) : NaN;
  const overCap = Number.isFinite(cap) && cap > 0 && b.cost_usd > cap;
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        overCap
          ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900"
          : "bg-muted/20"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="font-medium text-sm text-foreground">
          Projected cost: {fmtCost(b.cost_usd)}
        </span>
        <span className="text-muted-foreground">
          (no cache: {fmtCost(b.cost_usd_no_cache)} — saving{" "}
          {fmtCost(b.cost_usd_no_cache - b.cost_usd)} via prompt cache)
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px] text-muted-foreground">
        <div>{b.cases} case{b.cases === 1 ? "" : "s"}</div>
        <div>prefix {fmtTokens(b.prefix_tokens)} tok</div>
        <div>~{fmtTokens(b.per_case_input_tokens_avg)} in/case</div>
        <div>~{fmtTokens(b.output_tokens_per_case)} out/case</div>
      </div>
      {overCap ? (
        <div className="mt-1 text-rose-700 dark:text-rose-400 font-medium">
          Exceeds your ${cap.toFixed(2)} cap. The server will refuse to start this run.
        </div>
      ) : null}
    </div>
  );
}
