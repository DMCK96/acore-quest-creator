import { describe, expect, it } from 'vitest';
import { readScriptContext } from '../../src/core/scripts/context';
import { forkDb } from '../helpers/fixtures';

const condition = (comment: string, id: string) => ({
  SourceTypeOrReferenceId: '22', SourceGroup: '1', SourceEntry: id, SourceId: '0', ElseGroup: '0', ConditionTypeOrReference: '8',
  ConditionTarget: '0', ConditionValue1: '1', ConditionValue2: '0', ConditionValue3: '0', Comment: comment,
});

describe('reading the context of NPC scenes', () => {
  it("reads the NPC's tagged conditions and waypoints, and not another NPC's or a quest's", async () => {
    const db = forkDb();
    db.insert('conditions', condition('AQC npc100 s1: x', '100'));
    db.insert('conditions', condition('AQC npc200 s1: x', '200'));
    db.insert('conditions', condition('AQC q5 s1: x', '5'));
    db.insert('waypoints', { entry: '9001', pointid: '1', position_x: '0', position_y: '0', position_z: '0', point_comment: 'AQC npc100 s1: point 1' });
    db.insert('waypoints', { entry: '9002', pointid: '1', position_x: '0', position_y: '0', position_z: '0', point_comment: 'AQC npc200 s1: point 1' });
    const context = await readScriptContext(db, 0, [], [100]);
    expect(context.conditions.map((r) => r.Comment)).toEqual(['AQC npc100 s1: x']);
    expect(context.waypoints.map((r) => r.point_comment)).toEqual(['AQC npc100 s1: point 1']);
  });

  it('reads nothing extra when there are no extra creatures', async () => {
    const db = forkDb();
    db.insert('conditions', condition('AQC npc100 s1: x', '100'));
    expect((await readScriptContext(db, 0, [], [])).conditions).toEqual([]);
  });
});
