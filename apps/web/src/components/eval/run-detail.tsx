"use client";

import { Button } from "@healosbench/ui/components/button";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  getRunCases,
  getRunSummary,
  pauseRun,
  resumeRun,
  subscribeToRun,
  type RunCaseRow,
  type RunSummaryResponse,
} from "@/lib/api";

import { CasesTable } from "./cases-table";
import { RunSummaryCard } from "./run-summary-card";

/**
 * Live run-detail view. SSE drives incremental updates; we periodically
 * refetch the summary from the server when significant events happen (case
 * completed / failed, or run finished) so token/cost aggregates stay
 * consistent without us having to re-derive them in the browser.
 */
export function RunDetail({
  runId,
  initialSummary,
  initialCases,
}: {
  runId: string;
  initialSummary: RunSummaryResponse;
  initialCases: RunCaseRow[];
}) {
  const [summary, setSummary] = useState<RunSummaryResponse>(initialSummary);
  const [cases, setCases] = useState<RunCaseRow[]>(initialCases);
  const [working, setWorking] = useState<"pause" | "resume" | null>(null);

  const isLive =
    summary.run.status === "running" || summary.run.status === "pending";

  useEffect(() => {
    if (!isLive) return;
    const refetch = async () => {
      const [s, cs] = await Promise.all([
        getRunSummary(runId).catch(() => null),
        getRunCases(runId).catch(() => null),
      ]);
      if (s) setSummary(s);
      if (cs) setCases(cs);
    };
    const unsub = subscribeToRun(runId, (event) => {
      // Optimistic per-case status updates → users see "running" immediately.
      if (event.type === "case_started") {
        setCases((cur) =>
          cur.map((c) =>
            c.case_id === event.case_id
              ? { ...c, status: "running", started_at: new Date().toISOString() }
              : c,
          ),
        );
      } else if (event.type === "case_completed" || event.type === "case_failed") {
        // Authoritative refetch — gives us scores, attempts, token usage.
        void refetch();
      } else if (
        event.type === "run_completed" ||
        event.type === "run_paused" ||
        event.type === "run_failed"
      ) {
        void refetch();
      }
    });
    // Also poll every 10s as a safety net for missed events.
    const id = setInterval(refetch, 10_000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [runId, isLive]);

  const completed = useMemo(() => cases.filter((c) => c.status === "completed").length, [cases]);
  const running = useMemo(() => cases.filter((c) => c.status === "running").length, [cases]);

  async function handlePause() {
    setWorking("pause");
    try {
      await pauseRun(runId);
      toast.success("Pause requested. Already-started cases will finish.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pause failed");
    } finally {
      setWorking(null);
    }
  }

  async function handleResume(force = false) {
    setWorking("resume");
    try {
      await resumeRun(runId, force);
      toast.success(force ? "Run restarted (force)" : "Run resumed");
      const s = await getRunSummary(runId);
      if (s) setSummary(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resume failed");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {isLive ? (
            <span className="inline-flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
              live · {running} running · {completed}/{cases.length} done
            </span>
          ) : (
            `${completed}/${cases.length} cases complete`
          )}
        </div>
        <div className="flex gap-2">
          {summary.run.status === "running" ? (
            <Button variant="outline" disabled={working !== null} onClick={handlePause}>
              {working === "pause" ? "Pausing…" : "Pause"}
            </Button>
          ) : null}
          {(summary.run.status === "paused" || summary.run.status === "failed") ? (
            <Button disabled={working !== null} onClick={() => handleResume(false)}>
              {working === "resume" ? "Resuming…" : "Resume"}
            </Button>
          ) : null}
          {summary.run.status === "completed" ? (
            <Button
              variant="outline"
              disabled={working !== null}
              onClick={() => handleResume(true)}
            >
              Re-run (force)
            </Button>
          ) : null}
        </div>
      </div>

      <RunSummaryCard summary={summary} />

      <div>
        <h3 className="text-sm font-semibold mb-2">Cases</h3>
        <CasesTable runId={runId} cases={cases} />
      </div>
    </div>
  );
}
