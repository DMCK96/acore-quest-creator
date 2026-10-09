import { describe, it, expect } from 'vitest';
import { newNpc, newObject } from '@core/entities/model';
import type { CanvasNode } from '@shared/ipc';
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

  it('names the new quests of the project, not the ones the database has', () => {
    const node = { questId: 5000001, title: 'The Foreman', isNew: true } as CanvasNode;
    const stock = { questId: 12, title: 'Stock quest', isNew: false } as CanvasNode;
    const untitled = { questId: 5000002, title: ' ', isNew: true } as CanvasNode;
    const local = localNamesOf(undefined, [node, stock, untitled]);
    expect(local.quest.get(5000001)).toBe('The Foreman');
    expect(local.quest.get(5000002)).toBe('Quest 5000002');
    expect(local.quest.has(12)).toBe(false);
  });

  it('is empty without a project store', () => {
    const local = localNamesOf(undefined);
    expect(local.creature.size).toBe(0);
    expect(local.gameobject.size).toBe(0);
    expect(local.quest.size).toBe(0);
  });
});
