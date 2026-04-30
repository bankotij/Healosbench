import type { ToolDefinition } from "../tool";
import type { Strategy } from "@test-evals/shared";

/**
 * Anthropic message-shape we use across strategies. We deliberately type
 * this loosely (`unknown` content blocks) so strategies can mix text,
 * tool_use, and tool_result blocks without dragging the SDK types around.
 */
export interface PromptMessage {
  role: "user" | "assistant";
  content: unknown;
}

/**
 * A strategy is just data: how to build the system prompt and the prefix
 * messages (everything before the case transcript). Adding a fourth strategy
 * is a 30-line change — drop a new file in `strategies/`, register it in
 * `strategies/index.ts`, done.
 */
export interface PromptStrategy {
  id: Strategy;
  /** Returns the system text. Must be deterministic — it flows into the prompt hash. */
  buildSystem(): string;
  /** Returns the messages that come BEFORE the actual case transcript. */
  buildPrefixMessages(): PromptMessage[];
  /**
   * Some strategies (e.g. CoT) tweak how the user message wraps the
   * transcript. Override here; the default just includes the raw transcript.
   */
  buildUserMessage?(transcript: string): PromptMessage;
  /**
   * Optional — strategy-private metadata that should flow into the prompt
   * hash so subtle differences (e.g. set of few-shot example ids) become
   * unique hashes.
   */
  hashExtras?(): unknown;
  /** Tool used. All strategies share the single record_extraction tool today. */
  tool: ToolDefinition;
}

export function defaultUserMessage(transcript: string): PromptMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: `Transcript:\n\n${transcript}` },
    ],
  };
}
