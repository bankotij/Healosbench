import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { CostExceedsCapError } from "@test-evals/llm";
import { CreateRunRequestSchema, StrategySchema } from "@test-evals/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  createRun,
  estimateRun,
  getCaseDetail,
  getPromptDetail,
  getPromptDiff,
  getRunCases,
  getRunSummary,
  listDisagreements,
  listPrompts,
  listRuns,
  pauseRun,
  startRun,
} from "./services/runner.service";
import { subscribeToRun } from "./services/run_events";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

if (auth) {
  const authInstance = auth;
  app.on(["POST", "GET"], "/api/auth/*", (c) => authInstance.handler(c.req.raw));
}

app.get("/", (c) => c.text("OK"));
app.get("/health", (c) =>
  c.json({ ok: true, model: env.DEFAULT_MODEL, ts: new Date().toISOString() }),
);

// --------- Eval API --------------------------------------------------------

app.post("/api/v1/runs", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
  }
  try {
    const result = await createRun(parsed.data);
    startRun(result.run_id, { force: parsed.data.force ?? false });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof CostExceedsCapError) {
      return c.json(
        {
          error: "cost_exceeds_cap",
          projected_cost_usd: err.projected_cost_usd,
          max_cost_usd: err.max_cost_usd,
          breakdown: err.breakdown,
        },
        412,
      );
    }
    throw err;
  }
});

app.post("/api/v1/runs/estimate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({
      strategy: StrategySchema,
      model: z.string().min(1).optional(),
      dataset_filter: z.array(z.string().min(1)).optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
  }
  try {
    const view = await estimateRun({
      strategy: parsed.data.strategy,
      model: parsed.data.model ?? null,
      dataset_filter: parsed.data.dataset_filter ?? null,
    });
    return c.json(view);
  } catch (err) {
    return c.json(
      { error: "estimate_failed", message: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

app.get("/api/v1/runs", async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const rows = await listRuns(Number.isFinite(limit) ? limit : 50);
  return c.json({ runs: rows });
});

app.get("/api/v1/runs/:id", async (c) => {
  const summary = await getRunSummary(c.req.param("id"));
  if (!summary) return c.json({ error: "not_found" }, 404);
  return c.json(summary);
});

app.get("/api/v1/runs/:id/cases", async (c) => {
  const cases = await getRunCases(c.req.param("id"));
  return c.json({ cases });
});

app.get("/api/v1/runs/:id/cases/:caseId", async (c) => {
  const detail = await getCaseDetail(c.req.param("id"), c.req.param("caseId"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

app.get("/api/v1/prompts", async (c) => {
  const rows = await listPrompts();
  return c.json({ prompts: rows });
});

// Order matters: `/diff` must be registered before `/:hash` so the literal
// path doesn't match the parameterized one.
app.get("/api/v1/prompts/diff", async (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");
  if (!a || !b) return c.json({ error: "missing_params", required: ["a", "b"] }, 400);
  const diff = await getPromptDiff({ hashA: a, hashB: b });
  if (!diff) return c.json({ error: "not_found" }, 404);
  return c.json(diff);
});

app.get("/api/v1/prompts/:hash", async (c) => {
  const detail = await getPromptDetail(c.req.param("hash"));
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

app.get("/api/v1/disagreements", async (c) => {
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 5) || 5));
  const model = c.req.query("model") ?? null;
  const strategyRaw = c.req.query("strategy") ?? null;
  const strategy =
    strategyRaw === "zero_shot" || strategyRaw === "few_shot" || strategyRaw === "cot"
      ? strategyRaw
      : null;
  const rows = await listDisagreements({ limit, model, strategy });
  return c.json({ disagreements: rows });
});

app.post("/api/v1/runs/:id/resume", async (c) => {
  const id = c.req.param("id");
  const force = c.req.query("force") === "true";
  startRun(id, { force });
  return c.json({ run_id: id, status: "running" });
});

app.post("/api/v1/runs/:id/pause", async (c) => {
  pauseRun(c.req.param("id"));
  return c.json({ run_id: c.req.param("id"), status: "paused" });
});

app.get("/api/v1/runs/:id/stream", (c) => {
  const runId = c.req.param("id");
  return streamSSE(c, async (stream) => {
    let id = 0;
    const send = async (data: unknown) => {
      await stream.writeSSE({ id: String(id++), data: JSON.stringify(data) });
    };
    const unsubscribe = subscribeToRun(runId, (event) => {
      // Fire-and-forget — SSE writes are best-effort. If the stream errors
      // (client disconnect), the subscriber is dropped on the next emit.
      void send(event);
    });
    // Heartbeat to keep proxies happy and detect closed clients.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "" });
    }, 15000);
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    // Wait until the stream is aborted. Hono will close it when the client
    // disconnects; we just need to keep the handler alive in the meantime.
    await new Promise<void>((resolve) => stream.onAbort(resolve));
  });
});

export default {
  port: env.PORT,
  fetch: app.fetch,
};
