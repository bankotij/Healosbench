import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------- prompts ---------------------------------------------------------
//
// One row per *content-hashed* prompt. The same (strategy, system_prompt,
// few_shot, tool_definition) always hashes to the same `hash`, so referring
// to "prompt v6" by `hash` is unambiguous.

export const prompts = pgTable("prompts", {
  hash: text("hash").primaryKey(), // sha256 hex of canonical content
  strategy: text("strategy").notNull(),
  system_prompt: text("system_prompt").notNull(),
  tool_definition: jsonb("tool_definition").$type<unknown>().notNull(),
  few_shot_examples: jsonb("few_shot_examples").$type<unknown>(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// ---------- runs ------------------------------------------------------------

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    prompt_hash: text("prompt_hash")
      .notNull()
      .references(() => prompts.hash),
    status: text("status").notNull().default("pending"),
    dataset_filter: jsonb("dataset_filter").$type<string[] | null>(),

    cases_total: integer("cases_total").notNull().default(0),
    cases_completed: integer("cases_completed").notNull().default(0),
    cases_failed: integer("cases_failed").notNull().default(0),
    schema_failures: integer("schema_failures").notNull().default(0),
    hallucination_count: integer("hallucination_count").notNull().default(0),

    // Aggregate token usage across every attempt of every case.
    tokens_input: integer("tokens_input").notNull().default(0),
    tokens_output: integer("tokens_output").notNull().default(0),
    tokens_cache_read: integer("tokens_cache_read").notNull().default(0),
    tokens_cache_write: integer("tokens_cache_write").notNull().default(0),

    // Use numeric (no native fp) — keeps fractional cents precise.
    cost_usd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    overall_score: numeric("overall_score", { precision: 6, scale: 4 }),
    wall_ms: integer("wall_ms").notNull().default(0),

    started_at: timestamp("started_at"),
    finished_at: timestamp("finished_at"),
    error: text("error"),

    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("runs_status_idx").on(t.status),
    index("runs_strategy_model_idx").on(t.strategy, t.model),
    index("runs_prompt_hash_idx").on(t.prompt_hash),
  ],
);

// ---------- cases -----------------------------------------------------------
//
// One row per (run × transcript). Created up-front when a run starts so that
// resumability is just "process where status != completed". Idempotency
// across runs is implemented by looking up prior completed rows that share
// (strategy, model, prompt_hash, case_id) — no separate table needed.

export const cases = pgTable(
  "cases",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    /** Stable dataset id, e.g. "case_001". */
    case_id: text("case_id").notNull(),
    status: text("status").notNull().default("pending"),

    prediction: jsonb("prediction").$type<unknown>(),
    scores: jsonb("scores").$type<unknown>(),
    overall_score: numeric("overall_score", { precision: 6, scale: 4 }),
    hallucinated_fields: jsonb("hallucinated_fields").$type<string[]>(),
    schema_invalid: boolean("schema_invalid").notNull().default(false),

    attempts_count: integer("attempts_count").notNull().default(0),

    tokens_input: integer("tokens_input").notNull().default(0),
    tokens_output: integer("tokens_output").notNull().default(0),
    tokens_cache_read: integer("tokens_cache_read").notNull().default(0),
    tokens_cache_write: integer("tokens_cache_write").notNull().default(0),
    cost_usd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    wall_ms: integer("wall_ms").notNull().default(0),

    error: text("error"),
    started_at: timestamp("started_at"),
    finished_at: timestamp("finished_at"),

    /** True when this row was filled by copying a prior completed result. */
    cached_from_case_pk: text("cached_from_case_pk"),

    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("cases_run_case_uniq").on(t.run_id, t.case_id),
    index("cases_run_status_idx").on(t.run_id, t.status),
    index("cases_case_id_idx").on(t.case_id),
    // Powers idempotency lookup: "has anyone successfully run this exact
    // (strategy, model, prompt_hash, case_id) before?". The strategy / model
    // / prompt_hash live on `runs`, so we join — but indexing case_id alone
    // is enough to make that join cheap at this dataset size.
  ],
);

// ---------- attempts --------------------------------------------------------

export const attempts = pgTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    case_pk: text("case_pk")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    attempt_no: integer("attempt_no").notNull(),

    request_system: text("request_system").notNull(),
    request_messages: jsonb("request_messages").$type<unknown>().notNull(),
    request_tools: jsonb("request_tools").$type<unknown>(),
    request_model: text("request_model").notNull(),

    response_text: text("response_text"),
    response_tool_input: jsonb("response_tool_input").$type<unknown>(),
    stop_reason: text("stop_reason"),
    validation_errors: jsonb("validation_errors").$type<
      Array<{ path: string; message: string; code: string }> | null
    >(),
    error: text("error"),

    tokens_input: integer("tokens_input").notNull().default(0),
    tokens_output: integer("tokens_output").notNull().default(0),
    tokens_cache_read: integer("tokens_cache_read").notNull().default(0),
    tokens_cache_write: integer("tokens_cache_write").notNull().default(0),
    latency_ms: integer("latency_ms").notNull().default(0),

    created_at: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("attempts_case_attempt_uniq").on(t.case_pk, t.attempt_no),
    index("attempts_case_pk_idx").on(t.case_pk),
  ],
);

// ---------- types -----------------------------------------------------------

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Case = typeof cases.$inferSelect;
export type NewCase = typeof cases.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
