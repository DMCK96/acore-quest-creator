import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../../src/core/entities/context';
import { newObject, newSpawn } from '../../../src/core/entities/model';

describe('a tilted own object in the export', () => {
  it('writes its rotation as it is, and keeps the facing-only rotation without one', () => {
    const objects = [{ ...newObject(13000001), spawns: [{ ...newSpawn(901), o: 0.5, rotation: [0.1, 0.2, 0.3, 0.9] as [number, number, number, number] }, { ...newSpawn(902), o: 1 }] }];
    const out = compileEntities({ entities: { npcs: [], objects, items: [] }, givers: [], context: EMPTY_ENTITY_CONTEXT });
    const rows = out.inserts.gameobject!;
    expect(rows[0]).toMatchObject({ rotation0: '0.1', rotation1: '0.2', rotation2: '0.3', rotation3: '0.9', orientation: '0.5' });
    expect(rows[1]).toMatchObject({ rotation0: '0', rotation1: '0', rotation2: String(Math.round(Math.sin(0.5) * 1e6) / 1e6) });
  });
});
