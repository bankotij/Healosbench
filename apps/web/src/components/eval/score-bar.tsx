/**
 * Inline score bar (0..1). Rendered as a thin progress bar with the value
 * shown at the right. Color thresholds are tuned for clinical-extraction
 * scores: <0.5 red, <0.75 amber, ≥0.75 green.
 */
export function ScoreBar({
  score,
  width = 96,
}: {
  score: number | null | undefined;
  width?: number;
}) {
  if (score == null || !Number.isFinite(score)) {
    return <span className="text-zinc-400">—</span>;
  }
  const clamped = Math.max(0, Math.min(1, score));
  const color =
    clamped < 0.5
      ? "bg-rose-500"
      : clamped < 0.75
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 rounded bg-zinc-200 dark:bg-zinc-800"
        style={{ width }}
      >
        <div
          className={`h-full rounded ${color}`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
        {clamped.toFixed(3)}
      </span>
    </div>
  );
}
