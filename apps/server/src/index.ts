import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

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

export default app;
