import { describe, it, expect } from 'vitest';
import { REPUTATION_FACTIONS, factionName } from '@core/game/factions';
import { SKILLS, skillName } from '@core/game/skills';

describe('bundled game data', () => {
  it('names the well-known reputation factions', () => {
    expect(factionName(72)).toBe('Stormwind');
    expect(factionName(76)).toBe('Orgrimmar');
    expect(factionName(529)).toBe('Argent Dawn');
    expect(factionName(932)).toBe('The Aldor');
    expect(factionName(934)).toBe('The Scryers');
    expect(factionName(1106)).toBe('Argent Crusade');
    expect(factionName(999999)).toBeUndefined();
  });
  it('names the professions', () => {
    expect(skillName(186)).toBe('Mining');
    expect(skillName(171)).toBe('Alchemy');
    expect(skillName(356)).toBe('Fishing');
  });
  it('has unique ids, sorted by name', () => {
    for (const list of [REPUTATION_FACTIONS, SKILLS]) {
      expect(new Set(list.map((f) => f.id)).size).toBe(list.length);
      const names = list.map((f) => f.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });
});
