import { describe, it, expect } from 'vitest';
import { ENTITIES_FIELD, newNpc, newObject, writeEntities } from '@core/entities/model';
import { localNamesOf } from '../../src/renderer/state/names';

describe('localNamesOf', () => {
  it('names the quest\'s new NPCs and objects by entry', () => {
    const npc = { ...newNpc(11000231), name: 'Foreman Brask' };
    const object = { ...newObject(9000150), name: "Brask's Ledger" };
    const local = localNamesOf({ [ENTITIES_FIELD]: writeEntities({ npcs: [npc], objects: [object] }) });
    expect(local.creature.get(11000231)).toBe('Foreman Brask');
    expect(local.gameobject.get(9000150)).toBe("Brask's Ledger");
  });

  it('calls one not named yet what the editor calls it', () => {
    const local = localNamesOf({ [ENTITIES_FIELD]: writeEntities({ npcs: [newNpc(1)], objects: [newObject(2)] }) });
    expect(local.creature.get(1)).toBe('New NPC');
    expect(local.gameobject.get(2)).toBe('New object');
  });

  it('is empty without an open quest', () => {
    const local = localNamesOf(undefined);
    expect(local.creature.size).toBe(0);
    expect(local.gameobject.size).toBe(0);
  });
});
