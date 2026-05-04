import { headers } from "next/headers";

import { NewRunForm } from "@/components/eval/new-run-form";
import { RunsTable } from "@/components/eval/runs-table";
import type { RunListItem } from "@/lib/api";
import { env } from "@healosbench/env/web";

export const dynamic = "force-dynamic";

async function fetchInitialRuns(): Promise<RunListItem[]> {
  // Server-side fetch so the page renders with data on first load. Mirrors
  // the client-side `listRuns()` shape, just authenticated by the same CORS
  // origin (we forward cookies in case auth is later turned on).
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/runs?limit=50`;
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await fetch(url, {
    cache: "no-store",
    headers: cookie ? { cookie } : undefined,
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { runs: RunListItem[] };
  return json.runs;
}

export default async function RunsPage() {
  const initial = await fetchInitialRuns();
  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Eval runs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Each run executes a prompt strategy across the dataset and persists per-case scores,
          attempts, and token usage. Idempotency caching reuses prior cases that share the
          same (strategy, model, prompt-hash, transcript).
        </p>
      </div>

      <NewRunForm />

      <RunsTable initial={initial} />
    </div>
  );
}
