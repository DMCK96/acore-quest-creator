import { describe, it, expect } from 'vitest';
import { newNpc, newObject } from '@core/entities/model';
import { localNamesOf } from '../../src/renderer/state/names';

describe('localNamesOf', () => {
  it('names the project\'s new NPCs and objects by entry', () => {
    const npc = { ...newNpc(11000231), name: 'Foreman Brask' };
    const object = { ...newObject(9000150), name: "Brask's Ledger" };
    const local = localNamesOf({ npcs: [npc], objects: [object], items: [] });
    expect(local.creature.get(11000231)).toBe('Foreman Brask');
    expect(local.gameobject.get(9000150)).toBe("Brask's Ledger");
  });

  it('calls one not named yet what the editor calls it', () => {
    const local = localNamesOf({ npcs: [newNpc(1)], objects: [newObject(2)], items: [] });
    expect(local.creature.get(1)).toBe('New NPC');
    expect(local.gameobject.get(2)).toBe('New object');
  });

  it('is empty without a project store', () => {
    const local = localNamesOf(undefined);
    expect(local.creature.size).toBe(0);
    expect(local.gameobject.size).toBe(0);
  });
});
