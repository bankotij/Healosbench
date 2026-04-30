"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getRunCases, getRunSummary, type RunCaseRow, type RunListItem, type RunSummaryResponse } from "@/lib/api";
import { fmtCost, fmtDuration, fmtScore, fmtTokens, shortHash } from "@/lib/format";

import { ScoreBar } from "./score-bar";
import { RunStatusBadge } from "./status-badge";

export function CompareView({
  runs,
  initialA,
  initialB,
}: {
  runs: RunListItem[];
  initialA: string | null;
  initialB: string | null;
}) {
  const [aId, setAId] = useState<string | null>(initialA ?? runs[0]?.id ?? null);
  const [bId, setBId] = useState<string | null>(initialB ?? runs[1]?.id ?? null);

  if (runs.length < 2) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        Need at least two runs to compare. Start more runs from the{" "}
        <Link href="/runs" className="underline">runs page</Link>.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RunPicker label="Run A" value={aId} options={runs} onChange={setAId} />
        <RunPicker label="Run B" value={bId} options={runs} onChange={setBId} />
      </div>

      {aId && bId && aId !== bId ? (
        <CompareBody aId={aId} bId={bId} />
      ) : (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          Pick two distinct runs to compare.
        </div>
      )}
    </div>
  );
}

function RunPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: RunListItem[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm outline-none focus:border-primary"
      >
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {shortHash(r.id, 8)} · {r.strategy} · {r.cases_completed}/{r.cases_total} ·{" "}
            {new Date(r.created_at).toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompareBody({ aId, bId }: { aId: string; bId: string }) {
  const [a, setA] = useState<{ summary: RunSummaryResponse; cases: RunCaseRow[] } | null>(null);
  const [b, setB] = useState<{ summary: RunSummaryResponse; cases: RunCaseRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setA(null);
    setB(null);
    setError(null);
    Promise.all([
      Promise.all([getRunSummary(aId), getRunCases(aId)]),
      Promise.all([getRunSummary(bId), getRunCases(bId)]),
    ])
      .then(([[sA, csA], [sB, csB]]) => {
        if (!alive) return;
        if (!sA || !sB) {
          setError("One of the runs was not found.");
          return;
        }
        setA({ summary: sA, cases: csA });
        setB({ summary: sB, cases: csB });
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [aId, bId]);

  if (error)
    return (
      <div className="rounded-lg border bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-700">
        {error}
      </div>
    );
  if (!a || !b)
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CompareSummaryCard label="A" data={a} />
        <CompareSummaryCard label="B" data={b} />
      </div>

      <PerFieldDelta a={a.summary} b={b.summary} />

      <PerCaseDelta aId={aId} bId={bId} a={a.cases} b={b.cases} />
    </div>
  );
}

function CompareSummaryCard({
  label,
  data,
}: {
  label: string;
  data: { summary: RunSummaryResponse; cases: RunCaseRow[] };
}) {
  const r = data.summary.run;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Run {label}</div>
          <div className="text-sm font-mono">{shortHash(r.id, 12)}</div>
        </div>
        <RunStatusBadge status={r.status} />
      </div>
      <div className="text-sm">
        <span className="capitalize font-medium">{r.strategy.replace("_", "-")}</span>
        {" · "}
        <span className="text-muted-foreground font-mono">{r.model}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">
        {data.summary.overall_score == null ? "—" : data.summary.overall_score.toFixed(3)}
      </div>
      <div className="text-xs text-muted-foreground font-mono">
        {r.cases_completed}/{r.cases_total} cases · {fmtCost(r.cost_usd)} ·{" "}
        {fmtDuration(r.wall_ms)} · cache{" "}
        {fmtTokens(r.tokens_cache_read)}r / {fmtTokens(r.tokens_cache_write)}w
      </div>
    </div>
  );
}

function PerFieldDelta({ a, b }: { a: RunSummaryResponse; b: RunSummaryResponse }) {
  const fields = useMemo(() => {
    const aMap = new Map(a.per_field.map((f) => [f.field, f.mean_score]));
    const bMap = new Map(b.per_field.map((f) => [f.field, f.mean_score]));
    const all = Array.from(new Set([...aMap.keys(), ...bMap.keys()]));
    return all.map((field) => ({
      field,
      a: aMap.get(field) ?? null,
      b: bMap.get(field) ?? null,
    }));
  }, [a, b]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">Per-field comparison</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b">
            <th className="pb-2 font-medium">Field</th>
            <th className="pb-2 font-medium">A</th>
            <th className="pb-2 font-medium">B</th>
            <th className="pb-2 font-medium">Δ (B − A)</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(({ field, a: aS, b: bS }) => {
            const delta = aS != null && bS != null ? bS - aS : null;
            return (
              <tr key={field} className="border-b last:border-b-0">
                <td className="py-2 capitalize">{field.replace("_", " ")}</td>
                <td className="py-2"><ScoreBar score={aS} width={120} /></td>
                <td className="py-2"><ScoreBar score={bS} width={120} /></td>
                <td className="py-2 font-mono text-xs">
                  {delta == null ? (
                    "—"
                  ) : (
                    <span
                      className={
                        delta > 0.001
                          ? "text-emerald-600"
                          : delta < -0.001
                            ? "text-rose-600"
                            : "text-muted-foreground"
                      }
                    >
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(3)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PerCaseDelta({
  aId,
  bId,
  a,
  b,
}: {
  aId: string;
  bId: string;
  a: RunCaseRow[];
  b: RunCaseRow[];
}) {
  const rows = useMemo(() => {
    const aMap = new Map(a.map((c) => [c.case_id, c]));
    const bMap = new Map(b.map((c) => [c.case_id, c]));
    const ids = Array.from(new Set([...aMap.keys(), ...bMap.keys()])).sort();
    return ids.map((caseId) => {
      const ca = aMap.get(caseId);
      const cb = bMap.get(caseId);
      const sa = ca?.overall_score == null ? null : Number(ca.overall_score);
      const sb = cb?.overall_score == null ? null : Number(cb.overall_score);
      return {
        caseId,
        a: sa,
        b: sb,
        delta: sa != null && sb != null ? sb - sa : null,
      };
    });
  }, [a, b]);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">Per-case comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Case</th>
              <th className="px-3 py-2 font-medium">A score</th>
              <th className="px-3 py-2 font-medium">B score</th>
              <th className="px-3 py-2 font-medium">Δ</th>
              <th className="px-3 py-2 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ caseId, a: sa, b: sb, delta }) => (
              <tr key={caseId} className="border-b last:border-b-0">
                <td className="px-3 py-2 font-mono text-xs">{caseId}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmtScore(sa)}</td>
                <td className="px-3 py-2 font-mono text-xs">{fmtScore(sb)}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {delta == null ? (
                    "—"
                  ) : (
                    <span
                      className={
                        delta > 0.001
                          ? "text-emerald-600"
                          : delta < -0.001
                            ? "text-rose-600"
                            : "text-muted-foreground"
                      }
                    >
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(3)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <Link
                    href={`/runs/${aId}/cases/${caseId}`}
                    className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline mr-2"
                  >
                    A
                  </Link>
                  <Link
                    href={`/runs/${bId}/cases/${caseId}`}
                    className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  >
                    B
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
