import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Collects the ids of audit entries written while a Tally change runs, in the order they were
 * written. Undo walks them backwards. Outside a Tally change this does nothing.
 */
const recorder = new AsyncLocalStorage<string[]>();

export function recordingAudits<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  return recorder.run(ids, fn);
}

export function noteAudit(id: string | undefined): void {
  if (id) recorder.getStore()?.push(id);
}
