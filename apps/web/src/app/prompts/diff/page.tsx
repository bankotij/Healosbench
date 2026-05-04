import Link from "next/link";

import { PromptDiffView } from "@/components/eval/prompt-diff-view";
import type { PromptDiffResponse } from "@/lib/api";
import { env } from "@healosbench/env/web";

export const dynamic = "force-dynamic";

async function fetchDiff(a: string, b: string): Promise<PromptDiffResponse | null> {
  const url = new URL(
    "/api/v1/prompts/diff",
    env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, ""),
  );
  url.searchParams.set("a", a);
  url.searchParams.set("b", b);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as PromptDiffResponse;
}

export default async function PromptDiffPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  if (!sp.a || !sp.b) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-6 space-y-4">
        <div className="text-sm">
          <Link
            href="/prompts"
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            ← All prompts
          </Link>
        </div>
        <div className="rounded-lg border bg-card p-6 text-sm">
          Pick two prompts on the{" "}
          <Link href="/prompts" className="underline">
            prompts page
          </Link>{" "}
          and click <span className="font-mono">Diff →</span> to compare them.
        </div>
      </div>
    );
  }
  const diff = await fetchDiff(sp.a, sp.b);
  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="text-sm">
        <Link
          href="/prompts"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          ← All prompts
        </Link>
      </div>
      {diff ? (
        <PromptDiffView diff={diff} />
      ) : (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          One or both prompt hashes were not found.
        </div>
      )}
    </div>
  );
}
