"use client";

import Link from "next/link";

import type { PromptDiffResponse } from "@/lib/api";
import { fmtScore, shortHash } from "@/lib/format";

import { TextDiff } from "./text-diff";

export function PromptDiffView({ diff }: { diff: PromptDiffResponse }) {
  const { a, b, regressions } = diff;
  const regressionRows = regressions.filter((r) => Math.abs(r.delta) > 0.001);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prompt diff</h1>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <PromptHeader label="A" prompt={a} />
          <PromptHeader label="B" prompt={b} />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">System prompt</h2>
        <TextDiff a={a.system_prompt} b={b.system_prompt} labelA="A" labelB="B" />
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Tool definition</h2>
        <TextDiff
          a={JSON.stringify(a.tool_definition, null, 2)}
          b={JSON.stringify(b.tool_definition, null, 2)}
          labelA="A"
          labelB="B"
        />
      </div>

      {a.few_shot_examples != null || b.few_shot_examples != null ? (
        <div>
          <h2 className="text-sm font-semibold mb-2">Few-shot extras</h2>
          <TextDiff
            a={JSON.stringify(a.few_shot_examples ?? null, null, 2)}
            b={JSON.stringify(b.few_shot_examples ?? null, null, 2)}
            labelA="A"
            labelB="B"
          />
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold mb-2">
          Cases that moved (same case + model under both prompts)
        </h2>
        {regressionRows.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            No overlapping cases between these two prompts yet, or every overlapping case
            scored identically. Run both prompts on the same dataset filter to populate.
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Case</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">A</th>
                    <th className="px-3 py-2 font-medium">B</th>
                    <th className="px-3 py-2 font-medium">Δ (B − A)</th>
                  </tr>
                </thead>
                <tbody>
                  {regressionRows.map((r) => (
                    <tr key={`${r.case_id}|${r.model}`} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-mono text-xs">{r.case_id}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {r.model}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{fmtScore(r.a_score)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{fmtScore(r.b_score)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <span
                          className={
                            r.delta > 0.001
                              ? "text-emerald-600"
                              : r.delta < -0.001
                                ? "text-rose-600"
                                : "text-muted-foreground"
                          }
                        >
                          {r.delta > 0 ? "+" : ""}
                          {r.delta.toFixed(3)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PromptHeader({
  label,
  prompt,
}: {
  label: string;
  prompt: PromptDiffResponse["a"];
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">Prompt {label}</div>
      <Link
        href={`/prompts/${prompt.hash}`}
        className="font-mono text-xs break-all underline-offset-2 hover:underline"
      >
        {shortHash(prompt.hash, 16)}
      </Link>
      <div className="text-xs mt-1">
        <span className="capitalize font-medium">{prompt.strategy.replace("_", "-")}</span>
      </div>
    </div>
  );
}
