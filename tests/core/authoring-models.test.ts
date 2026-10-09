import { describe, expect, it } from 'vitest';
import { AUTHORING_MODELS, authoringSchema, authoringSummary, jsonSchemaOf, kindsIn } from '../../src/core/authoring/models';
import { emptyFight } from '../../src/core/combat/model';
import { newItem, newNpc, newObject } from '../../src/core/entities/model';

describe('the authoring models', () => {
  it('are the eight the assistant can author', () => {
    expect(AUTHORING_MODELS).toEqual(['scene', 'fight', 'patrol', 'loot', 'npc', 'object', 'item', 'gossip']);
  });

  it.each(AUTHORING_MODELS)('%s has a one-sentence summary and a JSON Schema that is not huge', (model) => {
    expect(authoringSummary(model).endsWith('.')).toBe(true);
    const js = jsonSchemaOf(model);
    expect(typeof js).toBe('object');
    const size = JSON.stringify(js).length;
    expect(size).toBeGreaterThan(100);
    expect(size).toBeLessThan(40_000);
  });

  it('describes every kind of scene trigger, gate and step in the scene schema', () => {
    const kinds = kindsIn(jsonSchemaOf('scene'));
    for (const kind of ['questAccepted', 'questHandedIn', 'spellHit', 'dies', 'talkedTo', 'gossipOption', 'enterArea', 'say', 'spawnNpc', 'startEscort', 'creature', 'gameobject', 'areatrigger', 'quest', 'item', 'team']) {
      expect(kinds).toContain(kind);
    }
  });

  it('describes the fight reactions and steps, and the patrol point actions', () => {
    expect(kindsIn(jsonSchemaOf('fight'))).toEqual(expect.arrayContaining(['healthBelow', 'aggro', 'death', 'cast', 'summonAdds', 'goToPhase']));
    expect(kindsIn(jsonSchemaOf('patrol'))).toEqual(expect.arrayContaining(['say', 'emote', 'pose', 'cast', 'sound', 'mount', 'dismount', 'useObject']));
  });

  it("accept the editor's own defaults", () => {
    expect(authoringSchema('fight').safeParse(emptyFight()).success).toBe(true);
    expect(authoringSchema('npc').safeParse(newNpc(90001)).success).toBe(true);
    expect(authoringSchema('object').safeParse(newObject(90002)).success).toBe(true);
    expect(authoringSchema('item').safeParse(newItem(90003)).success).toBe(true);
    expect(authoringSchema('gossip').safeParse({ menus: [{ menuId: 2000000001, textId: 2000000002, locked: false, greeting: [{ text: 'Hi', textFemale: '', probability: 1 }], options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false }] }] }).success).toBe(true);
    expect(authoringSchema('loot').safeParse([{ item: 769, chance: 50, min: 1, max: 1, questOnly: false }]).success).toBe(true);
  });

  it('refuse a value of the wrong shape', () => {
    expect(authoringSchema('loot').safeParse([{ item: 'x', chance: 50, min: 1, max: 1, questOnly: false }]).success).toBe(false);
    expect(authoringSchema('scene').safeParse({ id: 's1', name: 'x', owner: { kind: 'nope' }, trigger: { kind: 'questAccepted' }, gates: [], steps: [] }).success).toBe(false);
  });

  it('find kinds nested anywhere in a JSON Schema', () => {
    const js = { properties: { kind: { const: 'a' }, inner: { anyOf: [{ properties: { kind: { const: 'b' } } }, { properties: { kind: { const: 'a' } } }] } } };
    expect(kindsIn(js)).toEqual(['a', 'b']);
  });

  it('write a patrol without a path id: the editor chooses it', () => {
    const noPath = { startPace: 'walk', points: [] };
    expect(authoringSchema('patrol').safeParse(noPath).success).toBe(true);
    const required = (jsonSchemaOf('patrol') as { required?: string[] }).required ?? [];
    expect(required).not.toContain('pathId');
  });
});
