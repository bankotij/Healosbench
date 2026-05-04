import type { GroundingSpan } from "@healosbench/eval";

/**
 * Render a transcript with grounded ranges highlighted. The spans are
 * pre-computed server-side via `findGroundingSpans()` so this component
 * stays a small, dependency-free renderer.
 *
 * Visual:
 *   - exact match: solid emerald background
 *   - partial match (a content token only): dashed underline
 *   - hover: tooltip lists which prediction field(s) the span supports
 */
export function TranscriptHighlight({
  transcript,
  spans,
}: {
  transcript: string;
  spans: GroundingSpan[];
}) {
  if (!transcript) {
    return (
      <div className="text-xs text-muted-foreground italic">
        (transcript unavailable)
      </div>
    );
  }

  if (spans.length === 0) {
    return (
      <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
        {transcript}
      </pre>
    );
  }

  // Walk transcript, emit alternating plain segments and highlighted spans.
  const parts: Array<{ kind: "plain" | "span"; text: string; span?: GroundingSpan }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      parts.push({ kind: "plain", text: transcript.slice(cursor, span.start) });
    }
    parts.push({
      kind: "span",
      text: transcript.slice(span.start, span.end),
      span,
    });
    cursor = span.end;
  }
  if (cursor < transcript.length) {
    parts.push({ kind: "plain", text: transcript.slice(cursor) });
  }

  const exactCount = spans.filter((s) => s.match === "exact").length;
  const partialCount = spans.length - exactCount;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <LegendDot tier="exact" />
          <span>exact match ({exactCount})</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <LegendDot tier="partial" />
          <span>partial / token ({partialCount})</span>
        </span>
      </div>
      <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
        {parts.map((p, i) => {
          if (p.kind === "plain") return <span key={i}>{p.text}</span>;
          const s = p.span!;
          const cls =
            s.match === "exact"
              ? "rounded bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-950 dark:text-emerald-100"
              : "underline decoration-emerald-500 decoration-dashed underline-offset-2";
          return (
            <span
              key={i}
              className={cls}
              title={`${s.match === "exact" ? "Grounds" : "Partial token from"}: ${s.fields.join(", ")}`}
            >
              {p.text}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function LegendDot({ tier }: { tier: "exact" | "partial" }) {
  return tier === "exact" ? (
    <span className="inline-block h-2 w-3 rounded bg-emerald-300/80 dark:bg-emerald-800" />
  ) : (
    <span className="inline-block h-px w-3 border-b border-dashed border-emerald-500" />
  );
}
