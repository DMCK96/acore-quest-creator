import { describe, expect, it } from 'vitest';
import { forkDb } from '../helpers/fixtures';

describe('selectMax with a limit', () => {
  it('gives the largest value strictly below it', async () => {
    const db = forkDb();
    for (const id of ['10', '20', '16777215']) db.insert('npc_text', { ID: id });
    expect(await db.selectMax('npc_text', 'ID')).toBe(16777215);
    expect(await db.selectMax('npc_text', 'ID', 16_000_000)).toBe(20);
    expect(await db.selectMax('npc_text', 'ID', 10)).toBeNull();
  });
});
