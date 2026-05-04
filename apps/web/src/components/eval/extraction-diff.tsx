import type { Extraction } from "@healosbench/shared/extraction";
import type { FieldKey } from "@healosbench/shared/run";

import { ScoreBar } from "./score-bar";

/**
 * Side-by-side gold / prediction comparison. We render each field as its
 * own panel so the model's per-field strengths and weaknesses are obvious
 * at a glance. Scores are pulled from the case's per-field evaluation.
 */
export function ExtractionDiff({
  gold,
  prediction,
  scores,
  hallucinated,
}: {
  gold: Extraction | null;
  prediction: Extraction | null;
  scores: Array<{ field: FieldKey; score: number; precision?: number | null; recall?: number | null; f1?: number | null; details?: unknown }>;
  hallucinated: string[];
}) {
  const scoreByField = new Map(scores.map((s) => [s.field, s] as const));

  return (
    <div className="space-y-4">
      <FieldRow
        title="Chief complaint"
        score={scoreByField.get("chief_complaint")}
        gold={gold?.chief_complaint ?? null}
        pred={prediction?.chief_complaint ?? null}
        renderer="text"
      />

      <FieldRow
        title="Vitals"
        score={scoreByField.get("vitals")}
        gold={gold?.vitals ?? null}
        pred={prediction?.vitals ?? null}
        renderer="vitals"
      />

      <FieldRow
        title="Medications"
        score={scoreByField.get("medications")}
        gold={gold?.medications ?? null}
        pred={prediction?.medications ?? null}
        renderer="medications"
      />

      <FieldRow
        title="Diagnoses"
        score={scoreByField.get("diagnoses")}
        gold={gold?.diagnoses ?? null}
        pred={prediction?.diagnoses ?? null}
        renderer="diagnoses"
      />

      <FieldRow
        title="Plan"
        score={scoreByField.get("plan")}
        gold={gold?.plan ?? null}
        pred={prediction?.plan ?? null}
        renderer="plan"
      />

      <FieldRow
        title="Follow-up"
        score={scoreByField.get("follow_up")}
        gold={gold?.follow_up ?? null}
        pred={prediction?.follow_up ?? null}
        renderer="follow_up"
      />

      {hallucinated.length > 0 ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3">
          <div className="text-xs font-semibold text-rose-700 dark:text-rose-300 mb-1">
            Ungrounded values ({hallucinated.length})
          </div>
          <div className="text-xs font-mono space-y-1 text-rose-800 dark:text-rose-300">
            {hallucinated.map((h) => (
              <div key={h}>{h}</div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type FieldScore = {
  field: FieldKey;
  score: number;
  precision?: number | null;
  recall?: number | null;
  f1?: number | null;
  details?: unknown;
};

function FieldRow({
  title,
  score,
  gold,
  pred,
  renderer,
}: {
  title: string;
  score: FieldScore | undefined;
  gold: unknown;
  pred: unknown;
  renderer:
    | "text"
    | "vitals"
    | "medications"
    | "diagnoses"
    | "plan"
    | "follow_up";
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <div className="font-medium text-sm">{title}</div>
        <div className="flex items-center gap-3 text-xs">
          {score?.precision != null && score?.recall != null ? (
            <span className="text-muted-foreground font-mono">
              P {score.precision.toFixed(2)} · R {score.recall.toFixed(2)} · F1{" "}
              {(score.f1 ?? 0).toFixed(2)}
            </span>
          ) : null}
          <ScoreBar score={score?.score ?? null} width={100} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Panel label="Gold" tone="gold">
          <Renderer kind={renderer} value={gold} />
        </Panel>
        <Panel label="Prediction" tone="pred">
          <Renderer kind={renderer} value={pred} />
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "gold" | "pred";
  children: React.ReactNode;
}) {
  const cls =
    tone === "gold"
      ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20"
      : "border-blue-200 bg-blue-50/40 dark:border-blue-900/50 dark:bg-blue-950/20";
  return (
    <div className={`rounded-md border ${cls} p-3`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function Renderer({ kind, value }: { kind: string; value: unknown }) {
  if (value == null) return <div className="text-xs text-muted-foreground italic">—</div>;
  switch (kind) {
    case "text":
      return <div className="text-sm whitespace-pre-wrap">{String(value)}</div>;
    case "vitals":
      return <VitalsView v={value as Extraction["vitals"]} />;
    case "medications":
      return <MedsView meds={value as Extraction["medications"]} />;
    case "diagnoses":
      return <DiagsView diags={value as Extraction["diagnoses"]} />;
    case "plan":
      return <PlanView plan={value as string[]} />;
    case "follow_up":
      return <FollowUpView fu={value as Extraction["follow_up"]} />;
    default:
      return (
        <pre className="text-xs whitespace-pre-wrap font-mono">
          {JSON.stringify(value, null, 2)}
        </pre>
      );
  }
}

function VitalsView({ v }: { v: Extraction["vitals"] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <Field label="BP" value={v.bp} />
      <Field label="HR" value={v.hr == null ? null : `${v.hr} bpm`} />
      <Field label="Temp" value={v.temp_f == null ? null : `${v.temp_f}°F`} />
      <Field label="SpO₂" value={v.spo2 == null ? null : `${v.spo2}%`} />
    </dl>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="contents">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">
        {value == null ? <span className="text-muted-foreground italic">null</span> : value}
      </dd>
    </div>
  );
}

function MedsView({ meds }: { meds: Extraction["medications"] }) {
  if (meds.length === 0) {
    return <div className="text-xs text-muted-foreground italic">no medications</div>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {meds.map((m, i) => (
        <li key={`${m.name}-${i}`} className="font-mono text-xs">
          <span className="font-semibold">{m.name}</span>
          {m.dose ? ` · ${m.dose}` : ""}
          {m.frequency ? ` · ${m.frequency}` : ""}
          {m.route ? ` · ${m.route}` : ""}
        </li>
      ))}
    </ul>
  );
}

function DiagsView({ diags }: { diags: Extraction["diagnoses"] }) {
  if (diags.length === 0) {
    return <div className="text-xs text-muted-foreground italic">no diagnoses</div>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {diags.map((d, i) => (
        <li key={`${d.description}-${i}`} className="text-xs">
          <span className="font-medium">{d.description}</span>
          {d.icd10 ? (
            <span className="text-muted-foreground font-mono ml-1">[{d.icd10}]</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PlanView({ plan }: { plan: string[] }) {
  if (plan.length === 0) {
    return <div className="text-xs text-muted-foreground italic">no plan items</div>;
  }
  return (
    <ul className="space-y-1 text-sm list-disc pl-4">
      {plan.map((p, i) => (
        <li key={`${i}-${p.slice(0, 30)}`} className="text-xs">
          {p}
        </li>
      ))}
    </ul>
  );
}

function FollowUpView({ fu }: { fu: Extraction["follow_up"] }) {
  return (
    <dl className="space-y-1 text-sm">
      <Field
        label="Interval"
        value={fu.interval_days == null ? null : `${fu.interval_days} days`}
      />
      <Field label="Reason" value={fu.reason} />
    </dl>
  );
}
