import Link from "next/link";

import { CompareView } from "@/components/eval/compare-view";
import type { RunListItem } from "@/lib/api";
import { env } from "@test-evals/env/web";

export const dynamic = "force-dynamic";

async function fetchRuns(): Promise<RunListItem[]> {
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/runs?limit=50`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { runs: RunListItem[] };
  return json.runs;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const runs = await fetchRuns();
  const sp = await searchParams;
  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="text-sm">
        <Link href="/runs" className="text-muted-foreground hover:text-foreground hover:underline">
          ← All runs
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Compare runs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick two runs to see per-case score deltas, side-by-side. Useful for measuring
          whether a prompt change moved the needle.
        </p>
      </div>
      <CompareView runs={runs} initialA={sp.a ?? null} initialB={sp.b ?? null} />
    </div>
  );
}
