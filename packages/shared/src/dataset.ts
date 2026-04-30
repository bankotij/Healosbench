import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ExtractionSchema, type Extraction } from "./extraction.ts";

export interface DatasetCase {
  id: string; // e.g. "case_001"
  transcript: string;
  gold: Extraction;
}

const here = dirname(fileURLToPath(import.meta.url));
// packages/shared/src → workspace root is three levels up.
const REPO_ROOT = resolve(here, "..", "..", "..");
const DEFAULT_DATA_DIR = resolve(REPO_ROOT, "data");

export interface LoadDatasetOptions {
  dataDir?: string;
  filter?: ReadonlyArray<string>;
}

/**
 * Load all (transcript, gold) pairs from `data/`. Pairs are matched by
 * filename stem: `transcripts/case_001.txt` ↔ `gold/case_001.json`. Cases
 * missing one half of the pair are silently skipped.
 */
export async function loadDataset(
  opts: LoadDatasetOptions = {},
): Promise<DatasetCase[]> {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const transcriptDir = join(dataDir, "transcripts");
  const goldDir = join(dataDir, "gold");

  const transcriptFiles = await readdir(transcriptDir);
  const ids = transcriptFiles
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.slice(0, -".txt".length))
    .filter((id) => (opts.filter ? opts.filter.includes(id) : true))
    .sort();

  const cases: DatasetCase[] = [];
  for (const id of ids) {
    const tPath = join(transcriptDir, `${id}.txt`);
    const gPath = join(goldDir, `${id}.json`);
    let transcript: string;
    let goldRaw: string;
    try {
      [transcript, goldRaw] = await Promise.all([
        readFile(tPath, "utf8"),
        readFile(gPath, "utf8"),
      ]);
    } catch {
      // Missing pair — skip.
      continue;
    }
    const gold = ExtractionSchema.parse(JSON.parse(goldRaw));
    cases.push({ id, transcript, gold });
  }
  return cases;
}

export async function loadCase(
  id: string,
  opts: LoadDatasetOptions = {},
): Promise<DatasetCase | null> {
  const cases = await loadDataset({ ...opts, filter: [id] });
  return cases[0] ?? null;
}

export { DEFAULT_DATA_DIR, REPO_ROOT };
