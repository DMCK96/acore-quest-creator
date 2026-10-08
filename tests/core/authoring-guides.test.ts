import { describe, expect, it } from 'vitest';
import { AUTHORING_MODELS, jsonSchemaOf, kindsIn } from '../../src/core/authoring/models';
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
