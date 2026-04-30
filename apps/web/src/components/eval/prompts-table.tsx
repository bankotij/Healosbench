"use client";

import Link from "next/link";
import { useState } from "react";

import { type PromptListRow } from "@/lib/api";
import { fmtCost, fmtScore, fmtRelative, shortHash } from "@/lib/format";

export function PromptsTable({ initial }: { initial: PromptListRow[] }) {
  const [aHash, setAHash] = useState<string | null>(initial[0]?.hash ?? null);
  const [bHash, setBHash] = useState<string | null>(initial[1]?.hash ?? null);

  if (initial.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        No prompts yet. Start a run to materialize the first prompt row.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-semibold mb-3">Diff two prompts</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Picker label="A" value={aHash} onChange={setAHash} options={initial} />
          <Picker label="B" value={bHash} onChange={setBHash} options={initial} />
          {aHash && bHash && aHash !== bHash ? (
            <Link
              href={`/prompts/diff?a=${aHash}&b=${bHash}`}
              className="inline-flex h-9 items-center rounded-md border bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 self-end"
            >
              Diff →
            </Link>
          ) : (
            <div className="h-9 inline-flex items-center text-xs text-muted-foreground">
              Pick two distinct prompts
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Hash</th>
                <th className="px-3 py-2 font-medium">Strategy</th>
                <th className="px-3 py-2 font-medium">Runs</th>
                <th className="px-3 py-2 font-medium">Cases done</th>
                <th className="px-3 py-2 font-medium">Mean score</th>
                <th className="px-3 py-2 font-medium">Total cost</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {initial.map((p) => (
                <tr key={p.hash} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      href={`/prompts/${p.hash}`}
                      className="font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {shortHash(p.hash, 12)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 capitalize">{p.strategy.replace("_", "-")}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.runs_count}</td>
                  <td className="px-3 py-2 font-mono text-xs">{p.cases_completed}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmtScore(p.mean_overall_score)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtCost(p.total_cost_usd)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtRelative(p.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | null;
  onChange: (h: string) => void;
  options: PromptListRow[];
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm outline-none focus:border-primary"
      >
        {options.map((p) => (
          <option key={p.hash} value={p.hash}>
            {shortHash(p.hash, 10)} · {p.strategy} · score {fmtScore(p.mean_overall_score)}
          </option>
        ))}
      </select>
    </label>
  );
}
