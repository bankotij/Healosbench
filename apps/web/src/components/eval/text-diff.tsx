"use client";

import { useMemo } from "react";

import { diffLines, diffStats, pairRows } from "@/lib/line-diff";

export function TextDiff({
  a,
  b,
  labelA = "A",
  labelB = "B",
}: {
  a: string;
  b: string;
  labelA?: string;
  labelB?: string;
}) {
  const { ops, rows, stats } = useMemo(() => {
    const ops = diffLines(a, b);
    return {
      ops,
      rows: pairRows(ops),
      stats: diffStats(ops),
    };
  }, [a, b]);

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="border-b px-3 py-2 text-xs text-muted-foreground flex items-center gap-3">
        <span className="font-medium text-foreground">Diff</span>
        <span className="text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
        <span className="text-rose-600 dark:text-rose-400">−{stats.removed}</span>
        <span>={stats.equal}</span>
        <span className="ml-auto text-[11px]">{ops.length} lines</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-1 w-1/2">{labelA}</th>
              <th className="px-2 py-1 w-1/2">{labelB}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td
                  className={`align-top px-2 py-0.5 whitespace-pre-wrap break-words border-r ${
                    r.kind === "del" || r.kind === "mod"
                      ? "bg-rose-50 dark:bg-rose-950/30"
                      : ""
                  }`}
                >
                  {r.aLine ?? <span className="text-muted-foreground">·</span>}
                </td>
                <td
                  className={`align-top px-2 py-0.5 whitespace-pre-wrap break-words ${
                    r.kind === "add" || r.kind === "mod"
                      ? "bg-emerald-50 dark:bg-emerald-950/30"
                      : ""
                  }`}
                >
                  {r.bLine ?? <span className="text-muted-foreground">·</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
