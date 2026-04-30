import { createDb } from "@test-evals/db";
import * as schema from "@test-evals/db/schema/auth";
import { env } from "@test-evals/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth() {
  // The eval-harness assignment treats auth as optional (README: "ignore
  // unless useful"). Bail out cleanly so the server can boot from a `.env`
  // that only contains DATABASE_URL + ANTHROPIC_API_KEY.
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    return null;
  }

  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [],
  });
}

export const auth = createAuth();

export type Auth = NonNullable<ReturnType<typeof createAuth>>;
