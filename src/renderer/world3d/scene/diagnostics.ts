// @ts-nocheck
/**
 * What could not be loaded while a map streams in. Wowser's classes let one bad file (a model the
 * parser cannot read, a missing texture) fail a whole area; here the file is skipped, and told about
 * through this, so the view can say what is missing and the rest still draws.
 */

const problems: string[] = [];
const seen = new Set<string>();
const listeners = new Set<(all: readonly string[]) => void>();

/** Records a problem once per `key` (a file name, say) and tells the listeners. */
const reportProblem = (key: string, message: string) => {
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  problems.push(message);
  console.warn(`3D view: ${message}`);
  for (const listener of listeners) {
    listener(problems);
  }
};

/** An error's message and the first few places it came from, so a report says where as well as what. */
const describeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const where = (error.stack ?? '')
    .split('\n')
    .slice(1, 4)
    .map((line) => line.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^/]+\//, '(').replace(/\?[^:)]*/, ''))
    .join(' < ');
  return where ? `${error.message} [${where}]` : error.message;
};

/** Listens for problems; returns how to stop. The problems so far are passed at once. */
const onProblems = (listener: (all: readonly string[]) => void) => {
  listeners.add(listener);
  listener(problems);
  return () => {
    listeners.delete(listener);
  };
};

/** Forgets the problems of an earlier world, so a new one starts clean. */
const clearProblems = () => {
  problems.length = 0;
  seen.clear();
  for (const listener of listeners) {
    listener(problems);
  }
};

export { clearProblems, describeError, onProblems, reportProblem };
