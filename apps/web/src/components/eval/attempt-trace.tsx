"use client";

import { useState } from "react";

import type { AttemptRow } from "@/lib/api";
import { fmtCost, fmtTokens } from "@/lib/format";

/**
 * Collapsible per-attempt LLM trace. Each attempt shows:
 *  - the model + token / latency stats
 *  - the response (tool input or raw text)
 *  - validation errors (if the schema check failed and triggered a retry)
 *  - the full request prefix (system + messages + tools), opt-in
 */
export function AttemptTrace({ attempts }: { attempts: AttemptRow[] }) {
  if (attempts.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        No LLM attempts recorded for this case (likely served from idempotency cache).
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {attempts.map((a) => (
        <Attempt key={a.id} attempt={a} />
      ))}
    </div>
  );
}

function Attempt({ attempt: a }: { attempt: AttemptRow }) {
  const [showRequest, setShowRequest] = useState(false);
  const ok = !a.error && (a.validation_errors == null || a.validation_errors.length === 0);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Attempt {a.attempt_no}</span>
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
              ok
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
            }`}
          >
            {ok ? "validated" : a.error ? "error" : "schema retry"}
          </span>
          <span className="text-xs text-muted-foreground font-mono">{a.request_model}</span>
        </div>
        <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">
          {fmtTokens(a.tokens_input)} in · {fmtTokens(a.tokens_output)} out · {fmtTokens(a.tokens_cache_read)} cache-r ·{" "}
          {a.latency_ms}ms
        </div>
      </div>

      <div className="p-4 space-y-3">
        {a.validation_errors && a.validation_errors.length > 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1.5">
              Schema validation errors → retry with feedback
            </div>
            <ul className="text-xs font-mono space-y-1">
              {a.validation_errors.map((v, i) => (
                <li key={`${v.path}-${i}`}>
                  <span className="text-amber-700 dark:text-amber-300">{v.path || "(root)"}</span>:{" "}
                  {v.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {a.error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3">
            <div className="text-xs font-semibold text-rose-700 dark:text-rose-300 mb-1">
              Transport error
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap">{a.error}</pre>
          </div>
        ) : null}

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
            Response (
            {a.response_tool_input ? "tool_use" : a.response_text ? "text" : "empty"})
          </summary>
          <div className="mt-2">
            {a.response_tool_input ? (
              <pre className="rounded bg-muted/50 p-2.5 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(a.response_tool_input, null, 2)}
              </pre>
            ) : null}
            {a.response_text ? (
              <pre className="rounded bg-muted/50 p-2.5 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap mt-2">
                {a.response_text}
              </pre>
            ) : null}
            {a.stop_reason ? (
              <div className="mt-1 text-muted-foreground font-mono">
                stop_reason: {a.stop_reason}
              </div>
            ) : null}
          </div>
        </details>

        <div>
          <button
            type="button"
            onClick={() => setShowRequest((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showRequest ? "▾" : "▸"} Request prefix (system, messages, tool)
          </button>
          {showRequest ? (
            <div className="mt-2 space-y-2 text-[11px] font-mono">
              <div>
                <div className="text-muted-foreground mb-1">system ({a.request_system.length} chars)</div>
                <pre className="rounded bg-muted/50 p-2.5 overflow-x-auto whitespace-pre-wrap max-h-64">
                  {a.request_system}
                </pre>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">
                  messages ({a.request_messages.length})
                </div>
                <pre className="rounded bg-muted/50 p-2.5 overflow-x-auto whitespace-pre-wrap max-h-96">
                  {JSON.stringify(a.request_messages, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">tool</div>
                <pre className="rounded bg-muted/50 p-2.5 overflow-x-auto whitespace-pre-wrap max-h-64">
                  {JSON.stringify(a.request_tools, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
