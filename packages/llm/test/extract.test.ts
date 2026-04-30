import { describe, expect, test } from "bun:test";

import type { TokenUsage } from "@test-evals/shared";

import { type AnthropicCallInput, type AnthropicCallOutput } from "../src/client";
import { extractStructured } from "../src/extract";

const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

const TRANSCRIPT = "Doctor: Sore throat for four days. Patient: Yes.";

const VALID_EXTRACTION = {
  chief_complaint: "sore throat for four days",
  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
  medications: [],
  diagnoses: [{ description: "viral pharyngitis" }],
  plan: ["supportive care"],
  follow_up: { interval_days: null, reason: null },
};

const INVALID_EXTRACTION = {
  chief_complaint: "sore throat",
  vitals: { bp: "abc", hr: 80, temp_f: null, spo2: null }, // bp violates regex
  medications: [],
  diagnoses: [{ description: "viral pharyngitis" }],
  plan: ["supportive care"],
  follow_up: { interval_days: null, reason: null },
};

function makeMockCall(responses: unknown[]) {
  let i = 0;
  const mock = async (input: AnthropicCallInput): Promise<AnthropicCallOutput> => {
    void input; // not asserted on here
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      text: null,
      toolInput: next ?? null,
      stopReason: "tool_use",
      usage: { input: 100, output: 50, cache_read: 0, cache_write: 0 },
      requestForLog: { system: input.system, messages: input.messages, tools: [input.tool], model: input.model },
      rawResponse: {},
    };
  };
  return { mock, getCallCount: () => i };
}

describe("extractStructured() — schema retry with feedback", () => {
  test("invalid → valid path: 1 retry, prediction succeeds", async () => {
    const { mock, getCallCount } = makeMockCall([INVALID_EXTRACTION, VALID_EXTRACTION]);
    const out = await extractStructured({
      transcript: TRANSCRIPT,
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-mock",
      maxAttempts: 3,
      enableCache: false,
      call: mock,
    });
    expect(out.schemaInvalid).toBe(false);
    expect(out.prediction).toBeTruthy();
    expect(out.prediction?.chief_complaint).toBe(VALID_EXTRACTION.chief_complaint);
    expect(out.attempts).toHaveLength(2);
    expect(out.attempts[0]?.validation_errors).toBeTruthy();
    expect(out.attempts[1]?.validation_errors).toBeNull();
    expect(getCallCount()).toBe(2);
  });

  test("validation feedback message includes the failing path", async () => {
    const { mock } = makeMockCall([INVALID_EXTRACTION, VALID_EXTRACTION]);
    const out = await extractStructured({
      transcript: TRANSCRIPT,
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-mock",
      maxAttempts: 3,
      enableCache: false,
      call: mock,
    });
    // Attempt 2's request should contain the assistant's bad tool_use AND a
    // user tool_result with the validation feedback text.
    const a2 = out.attempts[1]!;
    const lastUserMsg = a2.request.messages.at(-1);
    expect(lastUserMsg?.role).toBe("user");
    const content = lastUserMsg?.content as Array<{ type: string; content?: string; is_error?: boolean }>;
    const toolResult = content.find((b) => b.type === "tool_result");
    expect(toolResult?.is_error).toBe(true);
    expect(toolResult?.content).toMatch(/vitals\.bp/);
  });

  test("respects maxAttempts cap (3)", async () => {
    // Always invalid → loop should stop at 3 attempts.
    const { mock, getCallCount } = makeMockCall([
      INVALID_EXTRACTION,
      INVALID_EXTRACTION,
      INVALID_EXTRACTION,
    ]);
    const out = await extractStructured({
      transcript: TRANSCRIPT,
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-mock",
      maxAttempts: 3,
      enableCache: false,
      call: mock,
    });
    expect(out.schemaInvalid).toBe(true);
    expect(out.prediction).toBeNull();
    expect(out.attempts).toHaveLength(3);
    expect(getCallCount()).toBe(3);
  });

  test("first-attempt success records exactly one attempt", async () => {
    const { mock } = makeMockCall([VALID_EXTRACTION]);
    const out = await extractStructured({
      transcript: TRANSCRIPT,
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-mock",
      maxAttempts: 3,
      enableCache: false,
      call: mock,
    });
    expect(out.attempts).toHaveLength(1);
    expect(out.schemaInvalid).toBe(false);
  });

  test("usage is summed across attempts", async () => {
    const { mock } = makeMockCall([INVALID_EXTRACTION, VALID_EXTRACTION]);
    const out = await extractStructured({
      transcript: TRANSCRIPT,
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-mock",
      maxAttempts: 3,
      enableCache: false,
      call: mock,
    });
    expect(out.usage.input).toBe(200); // 2 calls × 100
    expect(out.usage.output).toBe(100); // 2 calls × 50
  });

  test("transport error breaks the retry loop and propagates as schemaInvalid", async () => {
    const flaky = async (): Promise<AnthropicCallOutput> => {
      throw new Error("network kaput");
    };
    const out = await extractStructured({
      transcript: TRANSCRIPT,
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
      apiKey: "sk-mock",
      maxAttempts: 3,
      enableCache: false,
      call: flaky,
    });
    expect(out.attempts).toHaveLength(1);
    expect(out.attempts[0]?.error).toBe("network kaput");
    expect(out.schemaInvalid).toBe(true);
    expect(out.usage.input).toBe(0);
    expect(out.usage.output).toBe(0);
    void ZERO_USAGE; // touched to avoid unused-import lint
  });
});
