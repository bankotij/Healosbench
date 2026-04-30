import Link from "next/link";
import { notFound } from "next/navigation";

import { PromptDetail } from "@/components/eval/prompt-detail";
import type { PromptDetailResponse } from "@/lib/api";
import { env } from "@test-evals/env/web";

export const dynamic = "force-dynamic";

async function fetchDetail(hash: string): Promise<PromptDetailResponse | null> {
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/prompts/${hash}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as PromptDetailResponse;
}

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  const detail = await fetchDetail(hash);
  if (!detail) notFound();
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
      <PromptDetail detail={detail} />
    </div>
  );
}
