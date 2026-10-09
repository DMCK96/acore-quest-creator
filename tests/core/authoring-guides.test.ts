import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHORING_MODELS, choicesIn, jsonSchemaOf, kindsIn } from '../../src/core/authoring/models';
import { guideOf } from '../../src/core/authoring/guides';

describe('the guides', () => {
  it.each(AUTHORING_MODELS)('%s has a guide within the size limit, with the expected sections', (model) => {
    const guide = guideOf(model);
    expect(guide.length).toBeGreaterThan(400);
    expect(guide.length).toBeLessThanOrEqual(6000);
    for (const heading of ['## What it is', '## How the parts fit', '## Common mistakes', '## What the editor checks']) {
      expect(guide).toContain(heading);
    }
  });

  it.each(['scene', 'fight', 'patrol'] as const)('%s guide mentions every kind its model defines, so a new kind forces a guide edit', (model) => {
    const guide = guideOf(model);
    const missing = kindsIn(jsonSchemaOf(model)).filter((kind) => !guide.includes(`\`${kind}\``));
    expect(missing).toEqual([]);
  });

  it.each(AUTHORING_MODELS)('%s guide names every choice its model allows (a style, a state, a rank), each in code font as a whole word', (model) => {
    const guide = guideOf(model);
    const named = new Set([...guide.matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
    // An NPC embeds a fight and patrols, whose choices their own guides explain
    const embedded = new Set(['npc', 'object', 'item'].includes(model) ? [...choicesIn(jsonSchemaOf('fight')), ...choicesIn(jsonSchemaOf('patrol'))] : []);
    const missing = choicesIn(jsonSchemaOf(model)).filter((choice) => !embedded.has(choice) && !named.has(choice));
    expect(missing).toEqual([]);
  });

  it.each(['scene', 'fight', 'patrol'] as const)('%s guide has a Kinds section', (model) => {
    expect(guideOf(model)).toContain('## Kinds');
  });

  it.each(['loot', 'npc', 'object', 'item'] as const)('%s guide has a Fields section', (model) => {
    expect(guideOf(model)).toContain('## Fields');
  });

  it('tells the assistant what $N means and that text can use it', () => {
    expect(guideOf('scene')).toContain('$N');
  });

  it('says which faction ids are friendly and hostile to all', () => {
    const guide = guideOf('npc');
    expect(guide).toContain('35');
    expect(guide).toContain('14');
  });
});

describe('the guides tell the truth about the editor', () => {
  const sources = ['src/core/scripts/validate.ts', 'src/core/combat/validate.ts', 'src/core/entities/validate.ts', 'src/core/patrol/compile.ts']
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  it('cite only issue codes the editor really has', () => {
    for (const model of AUTHORING_MODELS) {
      const cited = [...guideOf(model).matchAll(/`((?:SCENE|FIGHT|ENTITY|ITEM|LOOT|PATROL)_[A-Z_]+)`/g)].map((m) => m[1]!);
      for (const code of cited) expect(sources.includes(`'${code}'`), `${model} guide cites ${code}`).toBe(true);
    }
  });

  it('cite enough codes that a reader can match what the editor reports', () => {
    const count = (model: Parameters<typeof guideOf>[0]) => new Set([...guideOf(model).matchAll(/`(?:SCENE|FIGHT|ENTITY|ITEM|LOOT|PATROL)_[A-Z_]+`/g)].map((m) => m[0])).size;
    expect(count('scene')).toBeGreaterThanOrEqual(4);
    expect(count('fight')).toBeGreaterThanOrEqual(4);
    expect(count('npc')).toBeGreaterThanOrEqual(3);
    expect(count('loot')).toBeGreaterThanOrEqual(2);
    expect(count('item')).toBeGreaterThanOrEqual(2);
  });

  it('do not claim checks the editor does not make', () => {
    expect(guideOf('npc')).not.toMatch(/too near another|wrong map/i);
    expect(guideOf('loot')).not.toMatch(/cannot find/i);
    expect(guideOf('patrol')).not.toMatch(/same time/i);
  });

  it('say how to place a new NPC or object, and that a new NPC is friendly until given a hostile faction', () => {
    for (const model of ['npc', 'object'] as const) {
      expect(guideOf(model)).toContain('allocate_ids');
      expect(guideOf(model)).toContain('upsert_entity');
    }
    for (const model of ['npc', 'fight'] as const) {
      expect(guideOf(model)).toMatch(/friendly/i);
      expect(guideOf(model)).toContain('14');
    }
  });

  it('say scene ids look like s1, s2 and so on', () => {
    expect(guideOf('scene')).toMatch(/`s1`/);
  });

  it('say the patrol path id is chosen by the editor', () => {
    expect(guideOf('patrol')).toMatch(/pathId.*(chosen|allocat)/s);
  });
});
