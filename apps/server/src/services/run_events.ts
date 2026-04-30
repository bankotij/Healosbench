import type { RunStreamEvent } from "@test-evals/shared";

/**
 * In-process pub/sub for SSE listeners. Per run-id we keep a Set of
 * subscriber callbacks; emit() invokes each. Buffering is deliberately
 * minimal — if a client disconnects mid-run they reconnect via the run
 * detail endpoint to read the final DB state.
 */

type Subscriber = (event: RunStreamEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribeToRun(runId: string, fn: Subscriber): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(runId);
  };
}

export function emitRunEvent(runId: string, event: RunStreamEvent): void {
  const set = subscribers.get(runId);
  if (!set || set.size === 0) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // Subscriber threw — drop it; SSE write errors are routine when a
      // client disconnects, and we don't want one bad listener to take
      // down the runner.
      set.delete(fn);
    }
  }
}
