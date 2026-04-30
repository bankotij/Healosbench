"use client";

import Link from "next/link";

import type { PromptDetailResponse } from "@/lib/api";
import { fmtCost, fmtScore, fmtRelative, shortHash } from "@/lib/format";

import { RunStatusBadge } from "./status-badge";

export function PromptDetail({ detail }: { detail: PromptDetailResponse }) {
  const p = detail.prompt;
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-muted-foreground">Prompt</div>
        <h1 className="text-2xl font-bold font-mono break-all">{p.hash}</h1>
        <div className="text-sm mt-1">
          <span className="capitalize font-medium">{p.strategy.replace("_", "-")}</span>{" "}
          · created {fmtRelative(p.created_at)}
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="border-b px-4 py-2 text-sm font-semibold">System prompt</div>
        <pre className="px-4 py-3 text-xs whitespace-pre-wrap font-mono max-h-[420px] overflow-y-auto">
          {p.system_prompt}
        </pre>
      </div>

      {p.few_shot_examples != null ? (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="border-b px-4 py-2 text-sm font-semibold">Few-shot extras</div>
          <pre className="px-4 py-3 text-xs whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
            {JSON.stringify(p.few_shot_examples, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="border-b px-4 py-2 text-sm font-semibold">Tool definition</div>
        <pre className="px-4 py-3 text-xs whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
          {JSON.stringify(p.tool_definition, null, 2)}
        </pre>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="border-b px-4 py-2 text-sm font-semibold">
          Runs using this prompt ({detail.runs.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Cases</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {detail.runs.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      href={`/runs/${r.id}`}
                      className="font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {shortHash(r.id, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                  <td className="px-3 py-2">
                    <RunStatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.cases_completed}/{r.cases_total}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmtScore(r.overall_score)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtCost(r.cost_usd)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtRelative(r.created_at)}
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
