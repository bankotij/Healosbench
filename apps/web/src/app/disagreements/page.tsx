import Link from "next/link";

import { DisagreementsTable } from "@/components/eval/disagreements-table";
import type { DisagreementRow } from "@/lib/api";
import { env } from "@test-evals/env/web";

export const dynamic = "force-dynamic";

async function fetchInitial(): Promise<DisagreementRow[]> {
  const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/api/v1/disagreements?limit=10`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { disagreements: DisagreementRow[] };
  return json.disagreements;
}

export default async function DisagreementsPage() {
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
        <h1 className="text-2xl font-bold">Disagreements</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          The cases where two or more runs disagree most about the right answer. These are
          the highest-information cases for a human reviewer — either one prompt found something
          another missed, or the gold is ambiguous and the metric is rewarding paraphrase. Spread
          is <span className="font-mono">max − min</span> overall_score across runs that used
          distinct prompt-hashes.
        </p>
      </div>

      <DisagreementsTable initial={initial} />
    </div>
  );
}
