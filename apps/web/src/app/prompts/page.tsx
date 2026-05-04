import Link from "next/link";

import { PromptsTable } from "@/components/eval/prompts-table";
import type { PromptListRow } from "@/lib/api";
import { env } from "@healosbench/env/web";

export const dynamic = "force-dynamic";

async function fetchInitial(): Promise<PromptListRow[]> {
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/prompts`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { prompts: PromptListRow[] };
  return json.prompts;
}

export default async function PromptsPage() {
  const initial = await fetchInitial();
  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="text-sm">
        <Link
          href="/runs"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          ← All runs
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">Prompts</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Every prompt is content-addressed by a sha256 of its strategy + system text + tool
          definition + few-shot examples. Editing any of those produces a new hash. Use this
          page to inspect a prompt's full text and to diff two prompts side-by-side.
        </p>
      </div>
      <PromptsTable initial={initial} />
    </div>
  );
}
