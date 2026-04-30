/**
 * System-prompt fragments shared across strategies. Anything strategy-specific
 * (chain-of-thought instructions, few-shot framing) belongs in the strategy
 * file, not here.
 *
 * IMPORTANT: changes to any of these strings invalidate the prompt cache and
 * change the prompt content hash — that's intentional. The README requires
 * "prompt v6" to mean exactly one set of bytes.
 */

export const ROLE = `You are a careful clinical-information-extraction assistant. \
Your job is to read a doctor-patient encounter transcript and record the structured \
JSON extraction by calling the \`record_extraction\` tool exactly once.`;

export const SAFETY_RULES = `Hard rules:
- Only record values that are explicitly stated in the transcript or are an unambiguous, direct paraphrase. Do not infer, guess, or fill in plausible defaults.
- If a vital was not measured or stated, set it to null. Do NOT pick a typical value.
- For medications, copy the dose, frequency, and route as the clinician stated them. If a field was not specified (e.g. route is omitted because it's obvious for an inhaler), use null rather than inventing.
- For ICD-10 codes, only include one if you are highly confident — otherwise omit the \`icd10\` field. A wrong code is worse than no code.
- Plan items are short, concrete actions ("start lisinopril 10 mg daily", "schedule labs in 2 weeks") — one item per discrete action, not a paragraph.
- For follow-up, \`interval_days\` is null when no concrete interval was given. "PRN", "as needed", or "return if worse" are all reason text with interval_days=null.`;

export const FORMAT_HINT = `Always call the \`record_extraction\` tool exactly once. \
Never write the JSON in plain text. Never wrap it in markdown.`;

/**
 * A standard re-prompt body the retry loop appends when the previous attempt
 * failed schema validation. The list of `errors` is rendered as a bullet list
 * so the model can see exactly which fields to fix.
 */
export function buildValidationFeedback(
  errors: ReadonlyArray<{ path: string; message: string }>,
): string {
  const bullets = errors
    .map((e) => `- ${e.path}: ${e.message}`)
    .join("\n");
  return `Your previous tool call did not pass schema validation. Fix these issues and call the \`record_extraction\` tool again with the corrected payload — do not change values that were already correct, only fix the listed errors.

Errors:
${bullets}`;
}
