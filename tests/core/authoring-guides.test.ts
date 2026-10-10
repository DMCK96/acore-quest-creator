import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHORING_MODELS, authoringSummary, choicesIn, jsonSchemaOf, kindsIn } from '../../src/core/authoring/models';
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
    // An NPC embeds a fight, patrols and scenes, whose choices their own guides explain
    const embedded = new Set(['npc', 'object', 'item'].includes(model) ? [...choicesIn(jsonSchemaOf('fight')), ...choicesIn(jsonSchemaOf('patrol')), ...choicesIn(jsonSchemaOf('npc-scripts'))] : []);
    const missing = choicesIn(jsonSchemaOf(model)).filter((choice) => !embedded.has(choice) && !named.has(choice));
    expect(missing).toEqual([]);
  });

  it.each(['scene', 'fight', 'patrol'] as const)('%s guide has a Kinds section', (model) => {
    expect(guideOf(model)).toContain('## Kinds');
  });

  it.each(['loot', 'npc', 'object', 'item', 'gossip'] as const)('%s guide has a Fields section', (model) => {
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
  const sources = ['src/core/scripts/validate.ts', 'src/core/combat/validate.ts', 'src/core/entities/validate.ts', 'src/core/patrol/compile.ts', 'src/core/scripts/npc-validate.ts']
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  it('cite only issue codes the editor really has', () => {
    for (const model of AUTHORING_MODELS) {
      const cited = [...guideOf(model).matchAll(/`((?:NPC_SCENE|SCENE|FIGHT|ENTITY|ITEM|LOOT|PATROL|VENDOR|TRAINER|GOSSIP)_[A-Z_]+)`/g)].map((m) => m[1]!);
      for (const code of cited) expect(sources.includes(`'${code}'`), `${model} guide cites ${code}`).toBe(true);
    }
  });

  it('cite enough codes that a reader can match what the editor reports', () => {
    const count = (model: Parameters<typeof guideOf>[0]) => new Set([...guideOf(model).matchAll(/`(?:NPC_SCENE|SCENE|FIGHT|ENTITY|ITEM|LOOT|PATROL|VENDOR|TRAINER|GOSSIP)_[A-Z_]+`/g)].map((m) => m[0])).size;
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

  it('npc guide and example cover vendor stock and cite its codes', async () => {
    const { examplesOf } = await import('../../src/core/authoring/examples');
    const guide = guideOf('npc');
    for (const word of ['`vendor`', '`maxCount`', '`restockSecs`', '`extendedCost`', '`VENDOR_DUPLICATE`', '`VENDOR_NO_ITEM`', '`VENDOR_UNKNOWN_ITEM`', '`VENDOR_NO_RESTOCK`', '`VENDOR_UNKNOWN_COST`', '`VENDOR_TOO_MANY`', '`VENDOR_NOT_READ`']) expect(guide).toContain(word);
    expect(jsonSchemaOf('npc')).toHaveProperty('properties.vendor');
    expect(guide).toMatch(/negative/i);
    expect(authoringSummary('npc')).toMatch(/sells/);
    expect((examplesOf('npc')[0]!.value as { vendor: unknown[] }).vendor.length).toBeGreaterThan(0);
  });

  it('npc guide and example cover trainers and cite their codes', async () => {
    const { examplesOf } = await import('../../src/core/authoring/examples');
    const guide = guideOf('npc');
    for (const word of ['`trainer`', '`trainerId`', '`requirement`', '`reqSpells`', 'allocate_ids', 'Give it its own copy', '`TRAINER_NO_ID`', '`TRAINER_NO_SPELL`', '`TRAINER_DUPLICATE`', '`TRAINER_REQ_SPELL`', '`TRAINER_NO_CLASS`', '`TRAINER_EMPTY`', '`TRAINER_UNKNOWN_SPELL`', '`TRAINER_NOT_READ`', '`TRAINER_ID_TAKEN`', '`TRAINER_ID_DUPLICATE`', '`TRAINER_SHARED`', '`TRAINER_LOCKED`']) expect(guide).toContain(word);
    expect(jsonSchemaOf('npc')).toHaveProperty('properties.trainer');
    expect(examplesOf('npc').some((e) => (e.value as { trainer?: unknown }).trainer)).toBe(true);
    expect(authoringSummary('npc')).toMatch(/teaches/);
    // The example only shows the shape: its id must come from allocate_ids, and cannot be one an editor would hand out first
    const trainerExample = examplesOf('npc').find((e) => (e.value as { trainer?: unknown }).trainer)!;
    expect((trainerExample.value as { trainer: { trainerId: number } }).trainer.trainerId).toBeGreaterThan(1_000_000_000);
    expect(guide).toMatch(/every class/);
  });

  it('gossip guide, example and the NPC guide cover what a menu is and cite its codes', async () => {
    const { examplesOf } = await import('../../src/core/authoring/examples');
    const guide = guideOf('gossip');
    const words = ['`menuId`', '`textId`', '`optionId`', '`kept`', '`locked`', 'allocate_ids', 'Give it its own copy', '`gossipMenu`',
      '`GOSSIP_KEPT_REMOVED`', '`GOSSIP_NO_ID`', '`GOSSIP_OPTION_NO_TEXT`', '`GOSSIP_NO_GREETING`', '`GOSSIP_ID_TAKEN`', '`GOSSIP_ID_DUPLICATE`', '`GOSSIP_SHARED`',
      '`GOSSIP_EMPTY_GREETING`', '`GOSSIP_UNKNOWN_MENU`', '`GOSSIP_UNREACHABLE`', '`GOSSIP_SERVICE_FLAG`', '`GOSSIP_SCENE`', '`GOSSIP_LOCKED`', '`GOSSIP_NOT_TALKABLE`', '`GOSSIP_NOT_READ`'];
    for (const word of words) expect(guide).toContain(word);
    for (const service of ['vendor', 'trainer', 'innkeeper', 'banker']) expect(guide.toLowerCase()).toContain(service);
    expect(guide).toContain('`close`');
    expect(guideOf('npc')).toContain('`gossipMenu`');
    expect(guideOf('npc')).toMatch(/describe_authoring/);
    const example = examplesOf('gossip')[0]!;
    expect((example.value as { menus: { menuId: number }[] }).menus[0]!.menuId).toBeGreaterThan(1_000_000_000);
    expect(jsonSchemaOf('npc')).toHaveProperty('properties.gossipMenu');
    expect(authoringSummary('gossip')).toMatch(/gossip/i);
  });

  it('say scene ids look like s1, s2 and so on', () => {
    expect(guideOf('scene')).toMatch(/`s1`/);
  });

  it('say the patrol path id is chosen by the editor', () => {
    expect(guideOf('patrol')).toMatch(/pathId.*(chosen|allocat)/s);
  });

  it('npc-scripts guide covers the shape, the quest rules, gossipPicked, locking and that database scripts are never edited', async () => {
    const { examplesOf } = await import('../../src/core/authoring/examples');
    const guide = guideOf('npc-scripts');
    const words = ['`gossipPicked`', '`questId`', 'locked', '`smart_scripts`', 'never edited', '`scenes`', 'AQC npc<entry> s<n>', '`NPC_SCENE_QUEST_NEEDED`', '`NPC_SCENE_OPTION_GONE`',
      '`NPC_SCENE_OPTION_LOCKED`', '`NPC_SCENE_ESCORT`', '`NPC_SCENE_ID_DUPLICATE`', '`NPC_SCENE_LIMIT`', '`NPC_SCENES_LOCKED`', '`NPC_SCENE_QUEST_UNKNOWN`', '`NPC_SCENE_NO_STEPS`'];
    for (const word of words) expect(guide).toContain(word);
    expect(guideOf('npc')).toContain('`npc-scripts`');
    expect(jsonSchemaOf('npc')).toHaveProperty('properties.scenes');
    expect(authoringSummary('npc-scripts')).toMatch(/scenes/i);
    expect(examplesOf('npc-scripts')[0]!.reading).toMatch(/handed in/);
  });
});
