import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** The profile directory names the app had as ACORE Quest Creator: the package name, then productName. */
const OLD_PROFILE_NAMES = ['acore-quest-creator', 'ACORE Quest Creator'];

/**
 * The app was called ACORE Quest Creator, and Electron names the profile directory after the app,
 * so the rename would leave saved connections, recent projects, recovery copies and the map cache
 * behind. The first launch under the new name takes the old directory over, if it has none yet.
 * Returns the directory it moved, or null.
 */
export function moveProfileFromOldName(appData: string, current: string): string | null {
  const old = OLD_PROFILE_NAMES.map((name) => join(appData, name)).find((dir) => existsSync(dir));
  if (existsSync(current) || old === undefined) return null;
  try {
    renameSync(old, current);
    return old;
  } catch (error) {
    console.warn(`Could not move the profile from ${old} to ${current}:`, error);
    return null;
  }
}
