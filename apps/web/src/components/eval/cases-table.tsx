import Link from "next/link";

import type { RunCaseRow } from "@/lib/api";
import { fmtCost, fmtDuration, fmtTokens } from "@/lib/format";

import { ScoreBar } from "./score-bar";
import { CaseStatusBadge } from "./status-badge";

export function CasesTable({
  runId,
  cases,
}: {
  runId: string;
  cases: RunCaseRow[];
}) {
  if (cases.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No cases yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Case</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Hallucinated</th>
              <th className="px-3 py-2 font-medium">Schema</th>
              <th className="px-3 py-2 font-medium">Attempts</th>
              <th className="px-3 py-2 font-medium">Tokens (in/out/cache-r)</th>
              <th className="px-3 py-2 font-medium">Cost</th>
              <th className="px-3 py-2 font-medium">Wall</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const score = c.overall_score == null ? null : Number(c.overall_score);
              const halls = c.hallucinated_fields ?? [];
              const cached = c.cached_from_case_pk != null;
              return (
                <tr key={c.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      href={`/runs/${runId}/cases/${c.case_id}`}
                      className="font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {c.case_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <CaseStatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-2">
                    <ScoreBar score={score} width={84} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {halls.length > 0 ? (
                      <span className="text-rose-600">{halls.length}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.schema_invalid ? (
                      <span className="text-rose-600">invalid</span>
                    ) : (
                      <span className="text-emerald-600">valid</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{c.attempts_count}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {fmtTokens(c.tokens_input)} / {fmtTokens(c.tokens_output)} /{" "}
                    {fmtTokens(c.tokens_cache_read)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtCost(c.cost_usd)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtDuration(c.wall_ms)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {cached ? "cached" : c.error ? <span className="text-rose-600">{c.error}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
