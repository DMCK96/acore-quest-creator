import { describe, expect, it } from 'vitest';
import { SCRIPTS_FIELD, nextSceneId, splitScenes, writeScenes } from '../../src/core/scripts/model';
import { moveMarker } from '../../src/core/map/positions';
import { jsonSchemaOf } from '../../src/core/authoring/models';

const broken = { id: 's4', owner: 'nobody' };
const good = {
  id: 's1', name: 'x', owner: { kind: 'creature', entry: 1 }, trigger: { kind: 'dies' }, gates: [],
  steps: [{ kind: 'moveTo', at: { x: 1, y: 1, z: 1, o: 0 }, waitMs: 0 }],
};

describe('scenes that cannot be read', () => {
  it('are split from the readable ones and written back after them', () => {
    const { scenes, unreadable } = splitScenes({ [SCRIPTS_FIELD]: [broken, good] });
    expect(scenes.map((s) => s.id)).toEqual(['s1']);
    expect(unreadable).toEqual([broken]);
    expect(writeScenes(scenes, unreadable)).toEqual([good, broken]);
  });

  it('keep their ids taken, and a removed highest id is handed out again', () => {
    expect(nextSceneId([good, broken])).toBe('s5');
    expect(nextSceneId([good])).toBe('s2');
    expect(nextSceneId([null, 5, {}])).toBe('s1');
  });

  it('survive a scene being dragged on the map', () => {
    const edit = moveMarker({ [SCRIPTS_FIELD]: [good, broken] } as never, { npcs: [], objects: [], items: [] }, 'scene:s1:0:at', { x: 9, y: 9, z: 9 });
    const written = (edit as { value: unknown[] }).value;
    expect(written).toHaveLength(2);
    expect(written[1]).toEqual(broken);
  });
});

describe('the entity JSON Schemas', () => {
  it.each(['npc', 'object', 'item'] as const)('%s requires no field, because new_entity takes a few at a time, and says so', (model) => {
    const js = jsonSchemaOf(model) as { required?: string[]; description?: string; properties: Record<string, unknown> };
    expect(js.required).toBeUndefined();
    expect(Object.keys(js.properties).length).toBeGreaterThan(5);
    expect(js.description).toMatch(/new_entity/);
  });
});
