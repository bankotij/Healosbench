import Link from "next/link";

import { env } from "@test-evals/env/web";

export const dynamic = "force-dynamic";

interface HealthResponse {
  ok: boolean;
  model: string;
  ts: string;
}

async function fetchHealth(): Promise<HealthResponse | null> {
  try {
    const url = `${env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, "")}/health`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

const TITLE_TEXT = `
██╗  ██╗███████╗ █████╗ ██╗      ██████╗ ███████╗██████╗ ███████╗███╗   ██╗ ██████╗██╗  ██╗
██║  ██║██╔════╝██╔══██╗██║     ██╔═══██╗██╔════╝██╔══██╗██╔════╝████╗  ██║██╔════╝██║  ██║
███████║█████╗  ███████║██║     ██║   ██║███████╗██████╔╝█████╗  ██╔██╗ ██║██║     ███████║
██╔══██║██╔══╝  ██╔══██║██║     ██║   ██║╚════██║██╔══██╗██╔══╝  ██║╚██╗██║██║     ██╔══██║
██║  ██║███████╗██║  ██║███████╗╚██████╔╝███████║██████╔╝███████╗██║ ╚████║╚██████╗██║  ██║
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝
`;

export default async function Home() {
  const health = await fetchHealth();
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-8">
      <pre className="overflow-x-auto font-mono text-[10px] sm:text-xs leading-tight text-foreground">
        {TITLE_TEXT}
      </pre>

      <div className="grid gap-6">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-semibold">Eval harness for structured clinical extraction</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Deterministic dataset · Anthropic tool-use · per-field metrics · prompt caching ·
            resumable runs · idempotency. Use the dashboard to launch runs, drill into a case,
            and diff prompt variants.
          </p>
          <div className="mt-4 flex gap-3 flex-wrap">
            <Link
              href="/runs"
              className="inline-flex items-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            >
              Open dashboard →
            </Link>
            <Link
              href="/compare"
              className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50"
            >
              Compare runs
            </Link>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold mb-2">API status</h2>
          {health ? (
            <div className="text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">Server reachable</span>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                model {health.model} · {new Date(health.ts).toLocaleString()}
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-muted-foreground">
                  Could not reach API at <span className="font-mono">{env.NEXT_PUBLIC_SERVER_URL}</span>.
                  Make sure <span className="font-mono">bun run dev:server</span> is running.
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
