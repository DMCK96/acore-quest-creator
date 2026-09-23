import type { Endpoint } from './model';
import type { NameBook } from './component';

/**
 * Shared text helpers for `ComponentDef.describe`, so every component reads a world entity the same
 * way: a cached name when the editor has one, an ID-shaped fallback when it does not.
 */

export function questName(id: number, names: NameBook): string {
  const name = names('quest', id);
  return name ? `${name} (${id})` : `quest ${id}`;
}

export function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function endpointName(e: Endpoint, names: NameBook): string {
  switch (e.kind) {
    case 'quest':
      return questName(e.questId, names);
    case 'creature': {
      const name = names('creature', e.entry);
      return name ? `${name} (${e.entry})` : `NPC ${e.entry}`;
    }
    case 'creatureSpawn':
      return `a spawn of an NPC (GUID ${e.guid})`;
    case 'gameobject': {
      const name = names('gameobject', e.entry);
      return name ? `${name} (${e.entry})` : `object ${e.entry}`;
    }
    case 'gameobjectSpawn':
      return `a spawned object (GUID ${e.guid})`;
    case 'item': {
      const name = names('item', e.entry);
      return name ? `${name} (${e.entry})` : `item ${e.entry}`;
    }
    case 'areatrigger':
      return `area trigger ${e.id}`;
    case 'script':
      return `SmartAI script ${e.entryorguid} (source type ${e.sourceType})`;
    case 'group':
      return `exclusive group ${e.group}`;
    case 'conditions':
      return 'conditions';
    case 'backend':
      return "the server's own code";
  }
}
