import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// The README places the canonical .env at `apps/server/.env`. Resolve it
// from this file's location so the env loads correctly no matter where the
// process is started from (server dev, db:push, eval CLI, tests, etc.).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
loadDotenv({ path: resolve(repoRoot, "apps/server/.env"), quiet: true });
// Also load any local .env in the cwd, so per-process overrides still work
// (e.g. tests with their own .env.test).
loadDotenv({ quiet: true });

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),

    // Anthropic — required for the eval harness.
    ANTHROPIC_API_KEY: z.string().min(1),
    DEFAULT_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),

    // Server runtime knobs.
    PORT: z.coerce.number().int().positive().default(8787),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Auth-related vars are optional — the README marks the auth package
    // as "ignore unless useful" for the eval task, so the server must boot
    // with just DATABASE_URL + ANTHROPIC_API_KEY in `apps/server/.env`.
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    BETTER_AUTH_URL: z.url().optional(),
    CORS_ORIGIN: z.url().default("http://localhost:3000"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
