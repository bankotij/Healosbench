"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { getRunSummary, listRuns, type RunListItem } from "@/lib/api";
import { fmtCost, fmtDuration, fmtRelative, fmtTokens, shortHash } from "@/lib/format";

import { ScoreBar } from "./score-bar";
import { RunStatusBadge } from "./status-badge";

export function RunsTable({
  initial,
  pollMs = 5000,
}: {
  initial: RunListItem[];
  pollMs?: number;
}) {
  const [runs, setRuns] = useState<RunListItem[]>(initial);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);
  const scoresVersion = useRef(0);

  // Poll the list while runs are still in flight. We stop polling once
  // every visible run is in a terminal state — keeps the dashboard quiet.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const next = await listRuns({ limit: 50 });
        if (!alive) return;
        setRuns(next);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    const id = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  // Fetch each run's overall score in parallel. We refetch when a row's
  // (status, cases_completed) changes — i.e. progress has happened.
  useEffect(() => {
    const myVersion = ++scoresVersion.current;
    const targets = runs.filter((r) => r.cases_completed > 0);
    Promise.all(
      targets.map(async (r) => {
        const summary = await getRunSummary(r.id).catch(() => null);
        return [r.id, summary?.overall_score ?? null] as const;
      }),
    ).then((entries) => {
      if (myVersion !== scoresVersion.current) return;
      setScores((prev) => {
        const next = { ...prev };
        for (const [id, s] of entries) next[id] = s;
        return next;
      });
    });
    // We intentionally key off a serialized progress signal so we don't
    // re-fetch summaries every poll when nothing has changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.map((r) => `${r.id}:${r.status}:${r.cases_completed}`).join("|")]);

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        No runs yet. Start one above to see it here.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {error ? (
        <div className="border-b bg-rose-50 px-3 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          Refresh failed: {error}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">Strategy</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Cases</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Hallucinated</th>
              <th className="px-3 py-2 font-medium">Tokens (in/out/cache)</th>
              <th className="px-3 py-2 font-medium">Cost</th>
              <th className="px-3 py-2 font-medium">Wall</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <RunRow key={r.id} run={r} overall={scores[r.id] ?? null} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunRow({ run, overall }: { run: RunListItem; overall: number | null }) {
  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30">
      <td className="px-3 py-2">
        <Link
          href={`/runs/${run.id}`}
          className="font-mono text-xs underline-offset-2 hover:underline"
        >
          {shortHash(run.id, 8)}
        </Link>
        <div className="text-[10px] text-muted-foreground font-mono">
          prompt {shortHash(run.prompt_hash, 8)}
        </div>
      </td>
      <td className="px-3 py-2 capitalize">{run.strategy.replace("_", "-")}</td>
      <td className="px-3 py-2">
        <RunStatusBadge status={run.status} />
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {run.cases_completed} / {run.cases_total}
        {run.cases_failed > 0 ? (
          <span className="text-rose-600"> ({run.cases_failed} failed)</span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <ScoreBar score={overall} width={80} />
      </td>
      <td className="px-3 py-2 font-mono text-xs">{run.hallucination_count}</td>
      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
        {fmtTokens(run.tokens_input)} / {fmtTokens(run.tokens_output)} /{" "}
        {fmtTokens(run.tokens_cache_read)}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{fmtCost(run.cost_usd)}</td>
      <td className="px-3 py-2 font-mono text-xs">{fmtDuration(run.wall_ms)}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {fmtRelative(run.created_at)}
      </td>
    </tr>
  );
}
