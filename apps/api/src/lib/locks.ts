const chains = new Map<string, Promise<unknown>>();

/**
 * Runs `task` once every earlier task with the same key has finished. Layout changes to one book
 * go through this (key = book id), so two of them can never read the same free slot and both
 * fill it. One API process serves the app, so an in-memory queue is enough.
 */
export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.then(
    () => {},
    () => {},
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
