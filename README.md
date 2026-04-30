# HEALOSBENCH

**An eval harness for structured clinical extraction.** Drop in a folder
of de-identified visit transcripts and gold JSON extractions, pick a
prompt strategy + model, watch a Next.js dashboard score the model
case-by-case in real time, and compare runs side-by-side to make a
defensible "ship this prompt / model" call.

> **Hosting note.** This project is **not** deployed publicly. The
> original assessment (preserved verbatim in the appendix at the end of this
> file) explicitly lists **deployment** under what they are not looking
> for — everything runs locally on `:3001` (web) and `:8787` (server).

---

## Quick start — verify the harness

Submission check: **`bun install && bun run eval -- --strategy=zero_shot`**
must work from a clean clone (with Postgres up and env configured).

```bash
docker compose up -d              # Postgres on host :5433 (see docker-compose.yml)

bun install
bun run db:push                   # apply Drizzle schema

# apps/server/.env — required:
#   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/healosbench
#   ANTHROPIC_API_KEY=sk-ant-…

bun run eval -- --strategy=zero_shot   # full 50-case run; ~$0.16 on Haiku 4.5

# Optional — dashboard
bun run dev                       # Next.js :3001, Hono :8787
```

A one-case smoke run (faster, ~$0.008):  
`bun run eval -- --strategy=zero_shot --filter=case_001 --force`

---

## 90-second tour

<video src="./docs/videos/01-overview.mov" controls width="100%"></video>

> If your markdown renderer doesn't play `.mov` inline, open
> [`docs/videos/01-overview.mov`](./docs/videos/01-overview.mov)
> directly.

---

## Quick links

| Doc | What's there |
|---|---|
| **`README.md`** *(this file)* | Project overview, dashboard tour, how to run, original assessment appendix |
| [`NOTES.md`](./NOTES.md) | Methodology, metric correctness pass, results, what surprised us, limitations |
| [`results/`](./results/) | CLI output for full 50-case runs (zero_shot, few_shot, cot) |

---

## TL;DR

- **Stack:** Bun monorepo · Hono server (`:8787`) · Next.js 16 dashboard (`:3001`) · Postgres via Drizzle · Anthropic SDK
- **Models:** Claude Haiku 4.5 (default), Sonnet 4.5 (cross-model spot-check)
- **Strategies:** `zero_shot` · `few_shot` (3 worked examples) · `cot` (chain-of-thought)
- **Concurrency:** Semaphore(5) + 429/529 backoff with `Retry-After` honored
- **Resilience:** Resumable runs · idempotent re-posts · retry-with-validation-feedback (cap 3 attempts)
- **Cost:** Pre-flight estimate · live cost panel in UI · `--max-cost` guardrail (HTTP 412 enforcement)
- **Streaming:** Server-Sent Events for live dashboard updates
- **Tests:** 106 pass / 0 fail / 250 expects across 12 files in <1s (`bun run test`)
- **Headline:** 0.71–0.72 overall on 50 cases for ~$0.16 per strategy. Combined three-strategy spend: $0.53 (well under the $1 budget).

---

## The problem

Given a clinical visit transcript like this:

> *Doctor:* Hi Eleanor, how can I help?
> *Patient:* I've been so constipated. I might go once every 4 or 5 days, and when I do it's hard and painful…

…produce structured JSON conforming to `data/schema.json`:

```json
{
  "chief_complaint": "chronic constipation for a couple months",
  "vitals": { "bp": null, "hr": null, "temp_f": null, "spo2": null },
  "medications": [
    { "name": "psyllium husk", "dose": "one tablespoon",
      "frequency": "once a day", "route": "PO" }
  ],
  "diagnoses": [{ "description": "chronic constipation", "icd10": "K59.00" }],
  "plan": ["psyllium husk one tablespoon mixed in water once a day, …"],
  "follow_up": { "interval_days": 28, "reason": "constipation recheck" }
}
```

…with a system around it that:

1. Doesn't crash on a malformed tool output (retry with the validator's error)
2. Doesn't burst-throttle Anthropic (semaphore + backoff)
3. Doesn't double-charge if you re-post the same run (idempotency)
4. Doesn't lose progress on crash (resumability)
5. Doesn't surprise you with a $40 bill (pre-flight cost estimate + cap)
6. Tells you *which fields* are getting worse when you tweak a prompt (compare view)
7. Surfaces *which cases* disagree most across runs so you know where to look (active learning)

The harness handles all seven.

---

## Tour of the dashboard

### 1. Home

![Home](./docs/screenshots/01-home.png)

Four navigation cards — **Runs**, **Compare**, **Disagreements**,
**Prompts**. Every other view is one click away.

### 2. Runs list + new-run form

![Runs list](./docs/screenshots/02-run-list.png)

The new-run form sits at the top: strategy picker, optional case filter
(`case_001,case_002,…`), optional cost cap, force-rerun checkbox, and a
**live cost estimate** that updates as you change strategy. Below it,
every past run with strategy, model, prompt-hash chip, per-field score
bars, hallucination count, cost, and status badge.

### 3. Cost estimate (close-up)

![Cost estimate](./docs/screenshots/03-cost-estimate.png)

Pre-flight estimate with cached vs uncached split. The "no cache: $X —
saving $Y via prompt cache" line is the prompt-caching ROI made
explicit. If you set a `Max cost (USD)` and the projection blows it,
the run is rejected with HTTP 412 *before* a single token is sent — the
cost guardrail stretch goal.

### 4. Run detail

![Run detail](./docs/screenshots/04-run-detail.png)

Summary card up top (overall + per-field bars + hallucination count +
cost + wall + tokens) and a per-case table below it. If the run is
still going, an SSE indicator pulses and rows fill in live as cases
finish.

### 5. Case detail — extraction diff + LLM trace + grounded transcript

![Case detail](./docs/screenshots/05-case-detail.png)

- **Transcript grounding highlights** — `findGroundingSpans()` in
  `packages/eval/src/grounding.ts` pre-computes ranges server-side.
  **`TranscriptHighlight`** renders **exact** substring matches as a solid
  emerald fill and **partial** content-token hits as a dashed underline;
  each span has a tooltip naming the backing prediction field(s). Policy
  matches the hallucination detector (e.g. skips diagnosis descriptions,
  skips medication frequency/route).
- **Extraction diff** — gold vs prediction side-by-side, per-field scores.
- **Attempt trace** — every LLM round-trip including retries, validation errors
  routed back into the model, token usage incl. cache read/write.

### 6. Compare view

![Compare](./docs/screenshots/06-compare.png)

Pick run A, pick run B. Per-field score deltas with a winner column,
per-case deltas sortable by spread.

### 7. Disagreements (active-learning hint)

![Disagreements](./docs/screenshots/07-disagreements.png)

Top-N cases by score *spread* across runs of different prompts.

### 8. Prompts list

![Prompts list](./docs/screenshots/08-prompts-list.png)

Every distinct prompt content-hash materialized by the harness.

### 9. Prompt detail

![Prompt detail](./docs/screenshots/09-prompt-detail.png)

Full system prompt + tool schema + runs that used this hash.

### 10. Prompt diff (with regression cases)

![Prompt diff](./docs/screenshots/10-prompt-diff.png)

Side-by-side LCS line diff + per-case regression list — **stretch goal**.

---

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────────┐
│ apps/web (Next.js 16, :3001)│  fetch  │ apps/server (Hono,   │
│  /, /runs, /runs/:id, …     │ ──────► │  :8787)              │
└─────────────────────────────┘  + SSE  │  REST + SSE          │
                                        └──────────┬───────────┘
                                                   │
                  ┌────────────────────────────────┼──────────────┐
                  │                                │              │
        services/runner.service.ts       services/extract.svc   db/
          • createRun / startRun          • wraps packages/llm  drizzle
          • SSE pub/sub                   • injects api key &     │
          • semaphore (5)                   default model        Postgres
          • idempotency lookup                                   (schema:
          • resumability filter                                   prompts,
                                                                  runs,
                                                                  cases,
                                                                  attempts)
        services/evaluate.service.ts     packages/llm/
          • per-field metrics              • client.ts (cache_control)
          • hallucination check            • rate_limiter.ts (semaphore + 429 backoff)
                                           • extract.ts (retry-with-feedback)
                                           • strategies/{zero_shot,few_shot,cot}
                                           • estimate.ts (pre-flight cost)
                                           • hash.ts (canonical sha256)
```

| Package | Role |
|---|---|
| `packages/llm` | Tool schema, strategies, retry-with-feedback, caching, semaphore + backoff, cost estimator |
| `packages/eval` | Per-field metrics, hallucination detector, grounding span builder for transcript UI |
| `packages/shared` | Zod-backed types, run/case/attempt DTOs, SSE event union |

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun | Assignment + fast harness |
| Monorepo | Bun workspaces + Turborepo | Minimal config |
| Database | Postgres + Drizzle | Schema as code |
| Server | Hono | Tiny · SSE-native on Bun |
| Frontend | Next.js 16 App Router | Starter-aligned |
| LLM | Anthropic SDK + enforced tool_use | Required |
| Type-check | `bun run check-types` | Turbo wraps `tsc --noEmit` |
| Tests | `bun run test` | 106 tests |

---

## The CLI

```bash
bun run eval -- --strategy=zero_shot

bun run eval -- --strategy=cot \
                --filter=case_001,case_002,case_003 \
                --max-cost=0.05

bun run eval -- --strategy=few_shot --estimate

bun run eval -- --strategy=zero_shot --model=claude-sonnet-4-5-20250929

bun run eval -- --strategy=zero_shot --force
```

---

## Metrics at a glance

| Field | Metric |
|---|---|
| `chief_complaint` | `tokenSetRatio` |
| `vitals.*` | Exact ± `temp_f` tolerance |
| `medications` | Set-F1; dose/frequency canonical + prefix containment |
| `diagnoses` | Set-F1 fuzzy + subset escape hatch + small ICD bonus |
| `plan` | Set-F1 fuzzy 0.65 |
| `follow_up` | Exact `interval_days` + fuzzy `reason` |

Full methodology → [`NOTES.md`](./NOTES.md#evaluation-methodology).

---

## Headline results (50 cases, Haiku 4.5)

| Strategy | Overall | Wall | Cost |
| --- | :-: | --- | --- |
| zero-shot | **0.716** | ~60s | ~$0.16 |
| few-shot | 0.715 | ~94s | ~$0.17 |
| cot | 0.712 | ~65s | ~$0.20 |

5-case Haiku vs Sonnet (zero-shot): Haiku ~0.70 · Sonnet ~0.80 — detail in NOTES.

---

## Stretch goals shipped

All items from the **original assessment** stretch section are implemented:

| # | Stretch | Where |
|---|---|---|
| 1 | Prompt diff | `/prompts/diff` |
| 2 | Active-learning / disagreements | `/disagreements` |
| 3 | Cost guardrail | `estimateCost()` + `--max-cost` + HTTP 412 |
| 4 | Second model | Sonnet 4.5 5-case + compare |

---

## What's covered by tests

`bun run test` → **106 pass / 0 fail / 250 expects** · 12 files  
(incl. grounding spans, hallucination, medications, runner idempotency / resume mocks, extract retry, rate limiter).

---

## Project layout

```
healosbench/
├── README.md                 ← You are here
├── NOTES.md
├── apps/server/ apps/web/
├── packages/{llm,eval,shared,db,env,…}
├── data/                     transcripts + gold + schema.json (do not modify gold/schema)
├── results/                  saved CLI summaries
└── docs/screenshots docs/videos
```

---

## Documentation map

- **`README.md`** — onboarding, dashboard tour, quick start.
- **`NOTES.md`** — deep methodology, metric fixes, empirical results.

---

---

## Appendix: Original HEALOSBENCH assessment specification

# HEALOSBENCH — Eval Harness for Structured Clinical Extraction

> **Take-home assessment** · target ~8–12 focused hours · synthetic data only

You're shipping an LLM-powered feature that turns a clinical transcript into structured JSON: chief complaint, vitals, medications, diagnoses, and follow-up plan. Once it's in production, you can't just "vibe-check" the prompt — you need a **repeatable evaluation harness** that tells you, with numbers, whether prompt v7 is better than prompt v6, on which fields, and where it fails.

Your job is to build that harness end-to-end: dataset loader, runner, evaluator, dashboard.

---

## Table of Contents

1. [What's Provided](#whats-provided)
2. [Stack](#stack)
3. [What You're Building](#what-youre-building)
4. [Hard Requirements](#hard-requirements)
5. [Stretch Goals](#stretch-goals)
6. [Constraints](#constraints)
7. [How to Run](#how-to-run)
8. [What We're Looking For](#what-were-looking-for)
9. [Submission](#submission)

---

## What's Provided

In `data/`:

| File | Description |
| --- | --- |
| `transcripts/*.txt` | 50 synthetic doctor–patient transcripts (~150–800 tokens each). Real-feeling but fully synthetic; no PHI. |
| `gold/*.json` | For each transcript, the ground-truth structured extraction a human annotator produced. |
| `schema.json` | The JSON Schema all extractions must conform to. |

The schema covers:

- `chief_complaint` *(string)*
- `vitals` *(object: `bp`, `hr`, `temp_f`, `spo2` — any may be `null`)*
- `medications` *(array of `{ name, dose, frequency, route }`)*
- `diagnoses` *(array of `{ description, icd10? }`)*
- `plan` *(array of strings)*
- `follow_up` *(object: `interval_days` int or null, `reason` string or null)*

> ⚠️ You **may not** modify the gold files or the schema. You **may** extend the transcript set with additional cases.

---

## Stack

The monorepo is already wired up:

- **Workspaces**: bun workspaces + Turborepo
- **`apps/web`** — Next.js 16 client-only dashboard
- **`apps/server`** — Hono on `:8787`, runs evals and stores results
- **`packages/db`** — Postgres + Drizzle ORM for storing runs
- **`packages/env`** — typed environment loading (zod)
- **`packages/auth`** — better-auth (not required for the eval task; ignore unless useful)
- **`packages/config`**, **`packages/ui`** — shared TS config and UI primitives

You will also create (or extend):

- **`packages/shared`** — shared types between server and web (schema types, run/result DTOs).
- **`packages/llm`** — a thin wrapper around the Anthropic SDK, with prompt strategies, tool use, retry-with-feedback, and prompt caching.

You'll need an Anthropic API key in `apps/server/.env` as `ANTHROPIC_API_KEY`. Use **Haiku 4.5** (`claude-haiku-4-5-20251001`) for cost; the eval is designed to be useful at Haiku quality.

---

## What You're Building

### 1. The extractor

> `packages/llm` + `apps/server/src/services/extract.service.ts`

- Takes a transcript and a **prompt strategy** (`zero_shot`, `few_shot`, `cot`) and returns extracted JSON.
- Use **Anthropic tool use** (or a strict JSON output mode) to force schema-conformant output. Free-form `JSON.parse` of model text is **not** acceptable.
- **Retry loop**: if the output fails JSON Schema validation, send the validation errors back to the model and let it self-correct. Cap at 3 attempts. Log every attempt.
- **Prompt caching**: the system prompt + few-shot examples must be cache-controlled so repeated runs don't pay for the same tokens. Verify via the SDK's `cache_read_input_tokens` field and surface this in the run summary.
- All three strategies live in the same codebase as swappable modules so adding a fourth is a 30-line change.

### 2. The evaluator

> `apps/server/src/services/evaluate.service.ts`

For each `(transcript, prediction, gold)` triple, compute **per-field scores using the metric appropriate to the field**:

| Field | Metric |
| --- | --- |
| `chief_complaint` | Fuzzy string match (normalize case/punctuation; token-set ratio or similar). Score ∈ [0, 1]. |
| `vitals.*` | Exact match per sub-field, with a tolerance for numeric fields (e.g. `temp_f` ±0.2 °F). Per-field 0/1, then averaged. |
| `medications` | Set-based **precision / recall / F1**. Two meds match if `name` is a fuzzy match **and** `dose` + `frequency` agree after normalization (e.g. `BID` == `twice daily`, `10 mg` == `10mg`). |
| `diagnoses` | Set-based F1 by `description` fuzzy match; bonus credit if predicted `icd10` matches gold. |
| `plan` | Set-based F1 on plan items, fuzzy-matched. |
| `follow_up` | Exact match on `interval_days`, fuzzy on `reason`. |

You must also detect and report:

- **Schema-invalid outputs** that escaped the retry loop (should be rare; track the rate).
- **Hallucinated fields** — values present in prediction but with no textual support in the transcript. Implement a simple grounding check: the predicted value (or a normalized form of it) must appear as a substring or close fuzzy match in the transcript. Flag and count these.

Per run, store: per-case scores, per-field aggregates, hallucination count, schema-failure count, total tokens (input/output/cache-read/cache-write), wall time, total cost in USD.

### 3. The runner

> `apps/server/src/services/runner.service.ts`

- `POST /api/v1/runs` with `{ strategy, model, dataset_filter? }` starts a run.
- Runs are concurrent (up to 5 cases in-flight) but respect Anthropic rate limits — implement a token-bucket or simple semaphore-with-backoff. **Don't** just `Promise.all` 50 cases.
- Stream progress to the dashboard via **SSE** as cases complete.
- Runs are **resumable**: if the server crashes mid-run, restarting and hitting `POST /api/v1/runs/:id/resume` continues from the last completed case (no double-charging).
- **Idempotency**: posting the same `{ strategy, model, transcript_id }` twice without `force=true` should return the cached result, not re-call the LLM.

### 4. The dashboard

> `apps/web`

- **Runs list** — every run, with strategy, model, aggregate F1, cost, duration, status.
- **Run detail** — table of all 50 cases with per-case scores; click into a case to see:
  - The transcript (highlighted where prediction values are grounded).
  - The gold JSON and the predicted JSON, side-by-side, with a **field-level diff**.
  - The full LLM trace: every attempt in the retry loop, each request and response, cache stats.
- **Compare view** — pick two runs and see per-field score deltas with a clear "which strategy wins on which field" breakdown. **This is the most important screen — make it good.**

### 5. Reproducibility

- A single command runs a full 50-case eval from the CLI without the dashboard, and prints a summary table to stdout. Used in CI / for sharing results:

  ```bash
  bun run eval -- --strategy=cot --model=claude-haiku-4-5-20251001
  ```

- Every run pins the prompt content via a **content hash** so "prompt v6" is unambiguous. Changing any character in the prompt produces a new hash.

---

## Hard Requirements

1. **Tool use / structured output, not regex on model text.** If you `JSON.parse` raw model output without a schema-enforcing path, you fail this requirement.
2. **Retry-with-error-feedback** loop, capped at 3, all attempts logged.
3. **Prompt caching** working and verified — show `cache_read_input_tokens` increasing across runs in the dashboard.
4. **Concurrency control** — no naïve `Promise.all`. Document (in `NOTES.md`) what your strategy does when Anthropic returns a 429.
5. **Resumable runs** — kill the server mid-run, restart, resume. This must actually work and you must include a test for it.
6. **Per-field metrics matched to field type** — exact, numeric-tolerant, fuzzy, set-F1 — used appropriately. A single "exact-match-everything" implementation fails this requirement.
7. **Hallucination detection** with a documented method, even if simple.
8. **Compare view** that surfaces real signal — not just two columns of numbers, but per-field deltas with a winner.
9. **At least 8 tests**, including: schema-validation retry path, fuzzy med matching, set-F1 correctness on a tiny synthetic case, hallucination detector positive + negative, resumability, idempotency, rate-limit backoff (mock the SDK), prompt-hash stability.
10. **No leaking the API key** to the browser. The web app talks only to Hono; only Hono talks to Anthropic.

---

## Stretch Goals

*Only if you have time — these are not required to pass.*

- **Prompt diff view** that shows what changed between two prompt versions and which cases regressed.
- **Active-learning hint**: surface the 5 cases with the highest disagreement between strategies — these are the cases most worth annotating better.
- **Cost guardrail**: refuse to start a run whose projected cost exceeds a configurable cap (estimate from token counts before sending).
- **Second model** (e.g. Sonnet 4.6) so the compare view also handles cross-model comparisons.

---

## Constraints

- **Synthetic data only.** Don't bring in real medical data, and don't put real patient info in test fixtures.
- **Budget**: a full 50-case Haiku run on all three strategies should cost **under $1**. If your harness can't hit that, your caching or prompt design needs work.
- **Time**: aim for **8–12 focused hours**. A polished 35-case version beats a buggy 50-case one.

---

## How to Run

```bash
# 1. Install
bun install

# 2. Configure
echo "ANTHROPIC_API_KEY=sk-ant-..." > apps/server/.env

# 3. Database (Postgres)
bun run db:push

# 4. Dev (web + server)
bun run dev

# 5. In another shell — CLI eval
bun run eval -- --strategy=zero_shot
```

You'll need a Postgres instance running locally. Set `DATABASE_URL` in `apps/server/.env` (e.g. `postgres://postgres:postgres@localhost:5432/healosbench`).

---

## What We're Looking For

- **Eval methodology taste.** The right metric for the right field. Honest reporting of failure modes (schema invalid, hallucinated, undergrounded). A compare view that would actually help you decide which prompt to ship.
- **Prompt engineering judgement.** Three strategies that are *meaningfully* different, not three flavors of the same prompt. A short writeup in `NOTES.md` of what you saw and why one wins on which fields.
- **LLM plumbing fluency.** Tool use, caching, retries, concurrency, idempotency — the things that separate a toy from a system you'd run in CI.
- **Test signal.** Tests target the things that actually break: rate limits, validation failures, resumes, fuzzy matchers.
- **A short `NOTES.md`** with: results table for the three strategies, what surprised you, what you'd build next, what you cut.

### What we're **not** looking for

- A pretty UI. Tailwind defaults are fine.
- Multi-user auth, multi-tenant, deployment.
- Hand-tuned prompts overfit to these 50 cases — we may swap the eval set.

---

## Submission

1. Push to a private repo and grant access, **or** zip the working tree (excluding `node_modules`).
2. Include `NOTES.md` at the repo root.
3. Include the output of one full 3-strategy CLI run (a `results/` folder or a paste in `NOTES.md`).
4. Make sure `bun install && bun run eval -- --strategy=zero_shot` works from a clean clone.

Good luck — and have fun.
