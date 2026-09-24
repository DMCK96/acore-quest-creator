import { describe, expect, it } from 'vitest';
import { sceneIssues, type SceneCheckInput } from '../../src/core/scripts/validate';
import type { QuestScene } from '../../src/core/scripts/model';

const scene = (over: Partial<QuestScene> = {}): QuestScene => ({
  id: 's1', name: '', owner: { kind: 'creature', entry: 299 }, trigger: { kind: 'dies' }, gates: [],
  steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }], ...over,
});
const check = (scenes: QuestScene[], over: Partial<SceneCheckInput> = {}) =>
  sceneIssues({ questId: 60001, scenes, objectives: [299, 0, 0, 0], givers: [{ kind: 'creature', entry: 240 }],
    enders: [{ kind: 'creature', entry: 240 }], cppOwners: [], missingTables: [], specialFlags: 0, ...over }).map((i) => [i.code, i.severity]);

describe('scene validation', () => {
  it('accepts a sound scene', () => expect(check([scene()])).toEqual([]));
  it('needs an owner', () => expect(check([scene({ owner: { kind: 'creature', entry: 0 } })])).toContainEqual(['SCENE_NO_OWNER', 'error']));
  it('warns about a scene that does nothing', () => expect(check([scene({ steps: [] })])).toEqual([['SCENE_NO_STEPS', 'warning']]));
  it('warns when a C++ script owns the NPC', () => expect(check([scene()], { cppOwners: ['creature:299'] })).toEqual([['SCENE_OWNER_CPP', 'warning']]));
  it('warns when accept is scripted on an NPC that does not give the quest', () =>
    expect(check([scene({ trigger: { kind: 'questAccepted' }, steps: [{ kind: 'emote', emote: 1, waitMs: 0 }] })])).toEqual([['SCENE_ACCEPT_NOT_GIVER', 'warning']]));
  it('refuses a player step where no player set the scene off', () =>
    expect(check([scene({ trigger: { kind: 'waypointReached', escortSceneId: 's9', point: 1 } })])).toContainEqual(['SCENE_NO_PLAYER', 'error']));
  it('refuses waits in an area scene', () =>
    expect(check([scene({ owner: { kind: 'areatrigger', id: 4 }, trigger: { kind: 'enterArea' }, steps: [{ kind: 'eventCredit', group: false, waitMs: 500 }] })], { specialFlags: 2 })).toEqual([['SCENE_AREA_WAIT', 'error']]));
  it('refuses credit for an objective the quest does not have', () =>
    expect(check([scene({ steps: [{ kind: 'credit', objective: 3, group: false, waitMs: 0 }] })])).toEqual([['SCENE_CREDIT_EMPTY', 'error']]));
  it('warns when the event objective flag is missing', () =>
    expect(check([scene({ steps: [{ kind: 'eventCredit', group: false, waitMs: 0 }] })])).toEqual([['SCENE_EVENT_FLAG', 'warning']]));
  it('refuses steps the owner cannot run and triggers it cannot have', () => {
    expect(check([scene({ owner: { kind: 'gameobject', entry: 5 }, trigger: { kind: 'dies' }, steps: [{ kind: 'say', text: 'x', style: 'say', waitMs: 0 }] })]))
      .toEqual([['SCENE_WRONG_OWNER', 'error'], ['SCENE_WRONG_OWNER', 'error']]);
  });
  it('refuses scenes that need a table the fork lacks', () =>
    expect(check([scene()], { missingTables: ['smart_scripts'] })).toEqual([['SCENE_TABLE_MISSING', 'error']]));
  it('refuses a waypoint scene on a different NPC from its escort', () => {
    const escort = scene({ id: 's1', trigger: { kind: 'questAccepted' }, steps: [{ kind: 'startEscort', points: [{ x: 1, y: 1, z: 1, o: 0 }], run: false, waitMs: 0 }] });
    const elsewhere = scene({ id: 's2', owner: { kind: 'creature', entry: 5 }, trigger: { kind: 'waypointReached', escortSceneId: 's1', point: 1 }, steps: [{ kind: 'emote', emote: 1, waitMs: 0 }] });
    expect(check([escort, elsewhere], { givers: [{ kind: 'creature', entry: 299 }], specialFlags: 2 })).toEqual([['SCENE_ESCORT_OWNER', 'error']]);
  });
  it('refuses an escort with no points', () =>
    expect(check([scene({ steps: [{ kind: 'startEscort', points: [], run: false, waitMs: 0 }] })], { specialFlags: 2 })).toEqual([['SCENE_STEP_INCOMPLETE', 'error']]));
  it('refuses steps left without what they act on', () => {
    const steps = [
      { kind: 'spawnNpc', entry: 0, at: { x: 0, y: 0, z: 0, o: 0 }, despawnAfterS: 5, attackPlayer: false, waitMs: 0 },
      { kind: 'giveItem', item: 0, count: 1, waitMs: 0 },
      { kind: 'castOnPlayer', spellId: 0, waitMs: 0 },
      { kind: 'say', text: '  ', style: 'say', waitMs: 0 },
      { kind: 'signal', signal: 1, targetKind: 'creature', entry: 0, range: 30, waitMs: 0 },
    ] as const;
    expect(check([scene({ steps: [...steps] })]).filter(([c]) => c === 'SCENE_STEP_INCOMPLETE')).toHaveLength(5);
  });
  it('refuses a waypoint scene pointing at a scene with no escort', () =>
    expect(check([scene({ id: 's2', trigger: { kind: 'waypointReached', escortSceneId: 's1', point: 1 }, steps: [{ kind: 'emote', emote: 1, waitMs: 0 }] }), scene()]))
      .toContainEqual(['SCENE_NO_ESCORT', 'error']));
});
