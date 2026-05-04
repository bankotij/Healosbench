import Link from "next/link";
import { notFound } from "next/navigation";

import { RunDetail } from "@/components/eval/run-detail";
import type { RunCaseRow, RunSummaryResponse } from "@/lib/api";
import { env } from "@healosbench/env/web";

export const dynamic = "force-dynamic";

async function fetchSummary(runId: string): Promise<RunSummaryResponse | null> {
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/runs/${runId}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchSummary: ${res.status}`);
  return (await res.json()) as RunSummaryResponse;
}

async function fetchCases(runId: string): Promise<RunCaseRow[]> {
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/runs/${runId}/cases`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { cases: RunCaseRow[] };
  return json.cases;
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [summary, cases] = await Promise.all([fetchSummary(id), fetchCases(id)]);
  if (!summary) notFound();

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="text-sm">
        <Link
          href="/runs"
          className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          ← All runs
        </Link>
      </div>
      <RunDetail runId={id} initialSummary={summary} initialCases={cases} />
    </div>
  );
}
