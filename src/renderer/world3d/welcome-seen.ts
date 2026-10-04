/** The projects that have had their welcome, per viewer: a list of project keys */
export const WELCOME_SEEN_KEY = 'acqc.welcome.seen';

/** Seen in this run, for when storage cannot be read or written */
const seenThisRun = new Set<string>();

/** A project's key: its file, or "untitled" for one not saved yet (so the welcome shows on the first launch only) */
export function projectKey(filePath: string | null): string {
  return filePath ? filePath : 'untitled';
}

function readSeen(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(WELCOME_SEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function welcomeSeen(key: string): boolean {
  return seenThisRun.has(key) || readSeen().includes(key);
}

export function markWelcomeSeen(key: string): void {
  try {
    const seen = readSeen();
    if (!seen.includes(key)) localStorage.setItem(WELCOME_SEEN_KEY, JSON.stringify([...seen, key]));
  } catch {
    // Storage unavailable: remembered for this run only.
    seenThisRun.add(key);
  }
}
