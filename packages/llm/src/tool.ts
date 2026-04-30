import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// packages/llm/src → repo root is three levels up.
const REPO_ROOT = resolve(here, "..", "..", "..");
const SCHEMA_PATH = resolve(REPO_ROOT, "data", "schema.json");

// Loaded once at module init. The README forbids modifying schema.json, so
// caching it for the lifetime of the process is safe — and it means we feed
// the *exact* assignment-defined schema into the Anthropic tool, which is
// what enforces "no regex on raw model text" structurally.
const RAW_SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Record<
  string,
  unknown
>;

export const EXTRACT_TOOL_NAME = "record_extraction" as const;

/**
 * The Anthropic tool definition that forces the model to emit a
 * schema-conformant object. We strip JSON-Schema-meta keys ($schema, $id,
 * title, description on the root) since Anthropic just wants the bare object
 * shape under input_schema.
 */
function buildToolInputSchema(): Record<string, unknown> {
  const {
    $schema: _schema,
    $id: _id,
    title: _title,
    description: _description,
    ...rest
  } = RAW_SCHEMA;
  return rest;
}

export const EXTRACT_TOOL = {
  name: EXTRACT_TOOL_NAME,
  description:
    "Record the structured clinical extraction for the provided transcript. " +
    "Call this exactly once per transcript with all required fields populated. " +
    "Use null for any vital that was not measured or stated. Use [] for arrays " +
    "with no items. Do not invent values that are not supported by the transcript.",
  input_schema: buildToolInputSchema(),
} as const;

export type ToolDefinition = typeof EXTRACT_TOOL;
