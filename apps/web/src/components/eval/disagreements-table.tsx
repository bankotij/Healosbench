"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { listDisagreements, type DisagreementRow } from "@/lib/api";
import { fmtScore, shortHash } from "@/lib/format";

const REFRESH_MS = 8000;

export function DisagreementsTable({ initial }: { initial: DisagreementRow[] }) {
  const [rows, setRows] = useState<DisagreementRow[]>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const next = await listDisagreements({ limit: 10 });
        if (!alive) return;
        setRows(next);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        No disagreements yet — you need at least two runs with different prompt-hashes that
        share at least one transcript before this view has anything to show.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border bg-rose-50 px-3 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          Refresh failed: {error}
        </div>
      ) : null}
      <ol className="space-y-3">
        {rows.map((row, idx) => (
          <DisagreementCard key={row.case_id} rank={idx + 1} row={row} />
        ))}
      </ol>
    </div>
  );
}

function DisagreementCard({ rank, row }: { rank: number; row: DisagreementRow }) {
  const sorted = [...row.contributors].sort((a, b) => b.overall_score - a.overall_score);
  const winner = sorted[0]!;
  const loser = sorted[sorted.length - 1]!;
  return (
    <li className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-mono text-muted-foreground">#{rank}</span>
          <span className="font-mono text-sm">{row.case_id}</span>
          <span className="text-xs text-muted-foreground">
            mean {fmtScore(row.mean_score)}
          </span>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">spread</div>
          <div className="font-mono text-lg tabular-nums">{row.spread.toFixed(3)}</div>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="text-xs text-muted-foreground">
          <span className="capitalize font-medium text-foreground">
            {winner.strategy.replace("_", "-")}
          </span>{" "}
          beats{" "}
          <span className="capitalize font-medium text-foreground">
            {loser.strategy.replace("_", "-")}
          </span>{" "}
          by{" "}
          <span className="font-mono text-foreground">
            {(winner.overall_score - loser.overall_score).toFixed(3)}
          </span>{" "}
          on this case
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1 font-medium">Strategy</th>
                <th className="py-1 font-medium">Model</th>
                <th className="py-1 font-medium">Prompt</th>
                <th className="py-1 font-medium">Score</th>
                <th className="py-1 font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.run_id} className="border-b last:border-b-0">
                  <td className="py-1.5 capitalize">{c.strategy.replace("_", "-")}</td>
                  <td className="py-1.5 font-mono text-xs text-muted-foreground">
                    {c.model}
                  </td>
                  <td className="py-1.5 font-mono text-xs text-muted-foreground">
                    {shortHash(c.prompt_hash, 10)}
                  </td>
                  <td className="py-1.5 font-mono text-xs tabular-nums">
                    {fmtScore(c.overall_score)}
                  </td>
                  <td className="py-1.5">
                    <Link
                      href={`/runs/${c.run_id}/cases/${row.case_id}`}
                      className="text-xs underline-offset-2 hover:underline"
                    >
                      case →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length === 2 ? (
          <div className="pt-1">
            <Link
              href={`/compare?a=${sorted[0]!.run_id}&b=${sorted[1]!.run_id}`}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Compare these two runs →
            </Link>
          </div>
        ) : null}
      </div>
    </li>
  );
}
