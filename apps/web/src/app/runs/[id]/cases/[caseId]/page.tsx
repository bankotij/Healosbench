import Link from "next/link";
import { notFound } from "next/navigation";

import { AttemptTrace } from "@/components/eval/attempt-trace";
import { ExtractionDiff } from "@/components/eval/extraction-diff";
import { CaseStatusBadge } from "@/components/eval/status-badge";
import { TranscriptHighlight } from "@/components/eval/transcript-highlight";
import type { CaseDetailResponse } from "@/lib/api";
import { fmtCost, fmtDuration, fmtTokens, shortHash } from "@/lib/format";
import { findGroundingSpans } from "@healosbench/eval";
import { env } from "@healosbench/env/web";
import type { Extraction } from "@healosbench/shared/extraction";
import type { FieldKey } from "@healosbench/shared/run";

export const dynamic = "force-dynamic";

async function fetchCase(
  runId: string,
  caseId: string,
): Promise<CaseDetailResponse | null> {
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/runs/${runId}/cases/${caseId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchCase: ${res.status}`);
  return (await res.json()) as CaseDetailResponse;
}

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string; caseId: string }>;
}) {
  const { id, caseId } = await params;
  const detail = await fetchCase(id, caseId);
  if (!detail) notFound();

  const c = detail.case;
  const scores = (c.scores ?? []) as Array<{
    field: FieldKey;
    score: number;
    precision?: number | null;
    recall?: number | null;
    f1?: number | null;
    details?: unknown;
  }>;
  const overall = c.overall_score == null ? null : Number(c.overall_score);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="text-sm flex items-center gap-2 text-muted-foreground">
        <Link href="/runs" className="hover:text-foreground hover:underline">
          All runs
        </Link>
        <span>/</span>
        <Link
          href={`/runs/${id}`}
          className="hover:text-foreground hover:underline font-mono"
        >
          {shortHash(id, 8)}
        </Link>
        <span>/</span>
        <span className="font-mono text-foreground">{caseId}</span>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold font-mono">{caseId}</h1>
              <CaseStatusBadge status={c.status} />
              {c.cached_from_case_pk ? (
                <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  served from cache
                </span>
              ) : null}
              {c.schema_invalid ? (
                <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                  schema invalid
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Overall</div>
            <div className="text-2xl font-bold tabular-nums">
              {overall == null ? "—" : overall.toFixed(3)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-sm">
          <Stat label="Attempts" value={String(c.attempts_count)} />
          <Stat
            label="Tokens (in/out)"
            value={`${fmtTokens(c.tokens_input)} / ${fmtTokens(c.tokens_output)}`}
            hint={
              c.tokens_cache_read || c.tokens_cache_write
                ? `cache ${fmtTokens(c.tokens_cache_read)} r / ${fmtTokens(c.tokens_cache_write)} w`
                : undefined
            }
          />
          <Stat label="Cost" value={fmtCost(c.cost_usd)} />
          <Stat label="Wall" value={fmtDuration(c.wall_ms)} />
        </div>

        {c.error ? (
          <pre className="mt-3 text-xs text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300 rounded p-2 whitespace-pre-wrap font-mono">
            {c.error}
          </pre>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Transcript</h2>
          <div className="rounded-lg border bg-card p-4 max-h-[28rem] overflow-y-auto">
            <TranscriptHighlight
              transcript={detail.transcript ?? ""}
              spans={findGroundingSpans(
                (c.prediction as Extraction | null) ?? null,
                detail.transcript ?? "",
              )}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Per-field diff (gold vs prediction)</h2>
          <ExtractionDiff
            gold={detail.gold}
            prediction={c.prediction}
            scores={scores}
            hallucinated={c.hallucinated_fields ?? []}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">LLM trace ({detail.attempts.length} attempts)</h2>
        <AttemptTrace attempts={detail.attempts} />
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm tabular-nums mt-0.5">{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </div>
  );
}
