import { describe, expect, it } from 'vitest';
import { entityFightTag, entityLootTag, entityOf, entityPatrolTag, entityTag, legacyEntityTags, sceneIdOf } from '../../src/core/scripts/tag';

describe('entity tags', () => {
  it('tags rows by entity, with a trailing space so 1200 never claims 12000', () => {
    expect(entityTag('npc', 12000001)).toBe('AQC npc12000001 ');
    expect(entityTag('obj', 9100001)).toBe('AQC obj9100001 ');
    expect(entityLootTag('obj', 9100001)).toBe('AQC obj9100001 loot');
    expect(entityFightTag(12000001)).toBe('AQC npc12000001 fight');
    expect(entityPatrolTag(12000001)).toBe('AQC npc12000001 patrol');
  });

  it('reads the entity back from a tagged comment, and nothing from others', () => {
    expect(entityOf('AQC npc12000001 fight:3 hit')).toEqual({ kind: 'npc', entry: 12000001, rest: 'fight:3 hit' });
    expect(entityOf('AQC obj9100001 ')).toEqual({ kind: 'obj', entry: 9100001, rest: '' });
    expect(entityOf('AQC q60001 npc12000001')).toBeNull();
    expect(entityOf('AQC npc12x')).toBeNull();
    expect(entityOf(null)).toBeNull();
  });

  it('never looks like a scene row', () => {
    expect(sceneIdOf('AQC npc12000001 fight', 60001)).toBeNull();
  });

  it('names the legacy quest tags of an entity for clean-up', () => {
    expect(legacyEntityTags('npc', 12000001, [60001, 60002])).toEqual(['AQC q60001 npc12000001', 'AQC q60002 npc12000001']);
  });
});
