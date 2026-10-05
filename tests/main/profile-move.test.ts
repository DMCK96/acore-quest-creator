import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveProfileFromOldName } from '../../src/main/profile-move';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const appData = () => { const d = mkdtempSync(join(tmpdir(), 'awe-appdata-')); dirs.push(d); return d; };
const profile = (root: string, name: string) => { const d = join(root, name); mkdirSync(d); writeFileSync(join(d, 'quest-creator.sqlite'), name); return d; };

describe('moveProfileFromOldName', () => {
  it('takes over the old profile when the new one does not exist yet', () => {
    const root = appData();
    const old = profile(root, 'acore-quest-creator');
    const current = join(root, 'azeroth-world-editor');
    expect(moveProfileFromOldName(root, current)).toBe(old);
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(join(current, 'quest-creator.sqlite'), 'utf8')).toBe('acore-quest-creator');
  });

  it('finds the old profile under the product name too', () => {
    const root = appData();
    profile(root, 'ACORE Quest Creator');
    const current = join(root, 'Azeroth World Editor');
    moveProfileFromOldName(root, current);
    expect(readFileSync(join(current, 'quest-creator.sqlite'), 'utf8')).toBe('ACORE Quest Creator');
  });

  it('leaves both alone once the new profile exists', () => {
    const root = appData();
    const old = profile(root, 'acore-quest-creator');
    const current = profile(root, 'azeroth-world-editor');
    expect(moveProfileFromOldName(root, current)).toBeNull();
    expect(existsSync(old)).toBe(true);
    expect(readFileSync(join(current, 'quest-creator.sqlite'), 'utf8')).toBe('azeroth-world-editor');
  });

  it('does nothing on a fresh install', () => {
    const root = appData();
    expect(moveProfileFromOldName(root, join(root, 'azeroth-world-editor'))).toBeNull();
  });
});
