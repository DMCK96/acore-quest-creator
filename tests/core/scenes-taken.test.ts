import { describe, expect, it } from 'vitest';
import { compileScenes } from '../../src/core/scripts/compile';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';
import type { QuestScene } from '../../src/core/scripts/model';

const scene: QuestScene = { id: 's1', name: 'Dies', owner: { kind: 'creature', entry: 12000001 }, trigger: { kind: 'dies' }, gates: [],
  steps: [{ kind: 'emote', emote: 1, waitMs: 0 }] };

describe('scene rows beside the project patch', () => {
  it('never take an id the project\'s fight rows on the same NPC use', () => {
    const taken = { inserts: { smart_scripts: [{ entryorguid: '12000001', source_type: '0', id: '0', link: '0' }, { entryorguid: '12000001', source_type: '0', id: '1', link: '0' }] }, deletes: {}, updates: [], flags: [], warnings: [] };
    const out = compileScenes({ questId: 60001, scenes: [scene], objectives: [0, 0, 0, 0], context: EMPTY_SCRIPT_CONTEXT, taken });
    const ids = out.inserts.smart_scripts!.filter((r) => r.entryorguid === '12000001' && r.source_type === '0').map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('0');
    expect(ids).not.toContain('1');
  });
});
