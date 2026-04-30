import { extractStructured, type ExtractInput, type ExtractOutput } from "@test-evals/llm";

import { env } from "@test-evals/env/server";

/**
 * Server-facing wrapper around `packages/llm`. Stateless: transcript in,
 * prediction + full LLM trace out. Persistence to the DB is the runner's
 * responsibility — keeping this layer pure means the CLI and tests can
 * call `extractTranscript` directly without booting the server stack.
 */
export interface ExtractTranscriptInput {
  transcript: string;
  strategy: ExtractInput["strategy"];
  /** Override env.DEFAULT_MODEL when set. */
  model?: string;
  /** Override the cap of 3 attempts (tests). */
  maxAttempts?: number;
  /** Override the SDK call (tests, mocked clients). */
  call?: ExtractInput["call"];
}

export type ExtractTranscriptResult = ExtractOutput;

export async function extractTranscript(
  input: ExtractTranscriptInput,
): Promise<ExtractTranscriptResult> {
  return extractStructured({
    transcript: input.transcript,
    strategy: input.strategy,
    model: input.model ?? env.DEFAULT_MODEL,
    apiKey: env.ANTHROPIC_API_KEY,
    maxAttempts: input.maxAttempts,
    call: input.call,
  });
}
