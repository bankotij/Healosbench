import type { RunSummaryResponse } from "@/lib/api";
import { fmtCost, fmtDuration, fmtTimestamp, fmtTokens, shortHash } from "@/lib/format";

import { ScoreBar } from "./score-bar";
import { RunStatusBadge } from "./status-badge";

export function RunSummaryCard({ summary }: { summary: RunSummaryResponse }) {
  const r = summary.run;
  const cacheRatio =
    r.tokens_cache_read + r.tokens_cache_write > 0
      ? r.tokens_cache_read / (r.tokens_cache_read + r.tokens_cache_write)
      : 0;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold capitalize">
              {r.strategy.replace("_", "-")}
            </h2>
            <RunStatusBadge status={r.status} />
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            run {shortHash(r.id, 12)} · model {r.model} · prompt {shortHash(r.prompt_hash, 12)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-muted-foreground">Overall score</div>
          <div className="text-3xl font-bold tabular-nums mt-0.5">
            {summary.overall_score == null ? "—" : summary.overall_score.toFixed(3)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
        <Stat label="Cases" value={`${r.cases_completed} / ${r.cases_total}`} hint={r.cases_failed > 0 ? `${r.cases_failed} failed` : undefined} />
        <Stat label="Schema retries" value={String(r.schema_failures)} />
        <Stat label="Hallucinated" value={String(r.hallucination_count)} />
        <Stat label="Tokens (in/out)" value={`${fmtTokens(r.tokens_input)} / ${fmtTokens(r.tokens_output)}`} />
        <Stat
          label="Cache (read/write)"
          value={`${fmtTokens(r.tokens_cache_read)} / ${fmtTokens(r.tokens_cache_write)}`}
          hint={cacheRatio > 0 ? `${(cacheRatio * 100).toFixed(0)}% read` : undefined}
        />
        <Stat label="Cost" value={fmtCost(r.cost_usd)} hint={fmtDuration(r.wall_ms)} />
      </div>

      {summary.per_field.length > 0 ? (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Per-field mean</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
            {summary.per_field.map((f) => (
              <div key={f.field} className="flex items-center gap-2 text-sm">
                <div className="w-32 text-muted-foreground capitalize">
                  {f.field.replace("_", " ")}
                </div>
                <div className="flex-1">
                  <ScoreBar score={f.mean_score} width={140} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground border-t pt-3">
        <div>
          <span className="font-medium">Started:</span> {fmtTimestamp(r.started_at)}
        </div>
        <div>
          <span className="font-medium">Finished:</span> {fmtTimestamp(r.finished_at)}
        </div>
      </div>
      {r.error ? (
        <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 rounded p-2 font-mono whitespace-pre-wrap">
          {r.error}
        </div>
      ) : null}
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
