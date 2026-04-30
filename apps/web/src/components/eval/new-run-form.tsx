"use client";

import { Button } from "@test-evals/ui/components/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createRun } from "@/lib/api";
import type { Strategy } from "@test-evals/shared/run";

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
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    const cases = filter
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    startTransition(async () => {
      try {
        const res = await createRun({
          strategy,
          dataset_filter: cases.length > 0 ? cases : undefined,
          force,
        });
        toast.success(`Run created (${res.cases_total} cases)`);
        onCreated?.(res.run_id);
        router.push(`/runs/${res.run_id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create run");
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
          className="h-4 w-4 rounded border"
        />
        <span>Force re-run (bypass idempotency cache)</span>
      </label>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Creating…" : "Start run"}
        </Button>
      </div>
    </div>
  );
}
