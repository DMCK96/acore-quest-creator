# NPC scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author give any NPC (new, or an existing one the project has taken over) scenes of its own: "when this happens to me, and only when these hold, do these steps", optionally tied to a quest, compiled to SmartAI rows at export.

**Architecture:** `CustomNpc` gains `scenes: NpcScene[]`. A scene is the quest scene minus its owner (always the NPC) plus a `questId` and a `gossipPicked` trigger. The existing scene compiler's per-scene body is extracted so quest scenes and NPC scenes share it; NPC scenes are tagged `AQC npc<entry> s<n>` and compiled in the project patch after fights and patrols. Existing NPCs get new rows beside the database's own `smart_scripts` rows, which are counted but never edited. The UI is a Scripts tab that reuses the quest scene editors, plus a right-click section.

**Tech Stack:** TypeScript, zod, React, Electron (main/renderer), vitest (+ jsdom), MySQL world DB behind `WorldDb` (fake in tests; the real `acore_world` for one integration test).

**Spec:** `docs/superpowers/specs/2026-10-09-npc-scripts-design.md`

**Base:** stacked on `feat/npc-gossip`; execute on `feat/npc-scripts` (already cut). It reuses `ProjectGossip`/`projectGossip` (`src/core/entities/gossip-tree.ts`), the gossip `kept` reading in `src/core/entities/from-rows.ts` (`gossipOf`), `entityIssues` in `src/core/entities/validate.ts`, `newEntityIssues` in `src/main/api/checks.ts`, `projectScripts` in `src/main/api/patches.ts`, the NPC tabs in `src/renderer/entities/npc/NpcEditor.tsx`, and the menu section pattern of `src/renderer/world3d/menu/sections/gossip.ts`.

## Global Constraints

- Tags (the trailing space keeps NPC 1200 from claiming 12000's rows): quest scenes `AQC q<quest> s<n>` (unchanged); fights `AQC npc<entry> fight`; patrols `AQC npc<entry> patrol`; NPC scenes **`AQC npc<entry> s<n>`**. The trigger row's comment also carries the whole scene as JSON after the marker ` #aqc=`.
- `npcRowOwner(comment, kind)` gains kind `'scene'`, matching `^s\d+(:|$)` after the NPC tag.
- Model: `NpcScene = { id: 's<n>', name: string, questId: int >= 0, trigger: SceneTrigger | { kind: 'gossipPicked', menuId: int, optionId: int }, gates: SceneGate[], steps: SceneStep[] }`. `CustomNpc.scenes: NpcScene[]`, default `[]`. Quest scenes (`sceneSchema`) do not change shape. A quest gate with `questId` 0 means the scene's own quest. Cap: 32 scenes per NPC.
- Triggers an NPC scene may use: `talkedTo`, `gossipOption`, `gossipPicked`, `spellHit`, `dies`, `playerNear`, `signal`, `summoned`, `waypointReached` (names an escort scene of this NPC), and `questAccepted`, `questHandedIn` (need `questId`). `enterArea` is not offered. All steps are allowed; `credit`, `eventCredit` and `failQuest` need `questId`.
- `gossipPicked (menuId, optionId)` compiles to an event 62 row (`EVENT.gossipSelect`, params menu, option) on the NPC (`source_type` 0). It writes nothing in the gossip tables. The option must be in the NPC's own tree, not in a locked menu, and not `kept`.
- Only `smart_scripts` rows are the scenes' own; `creature_template.AIName` is set to `SmartAI` only where it is empty (`onlyIf: { AIName: '' }`); `creature_text`, `waypoints` and `conditions` as the quest compiler already writes them.
- Locked: `AIName` neither empty nor `SmartAI`, or `ScriptName` non-empty. A locked NPC's scenes are shown read-only, the compiler writes nothing for them, and the checks warn. `origin.locked` gains `'scenes'`; `origin` gains `databaseScripts` (count of the NPC's `smart_scripts` rows not ours).
- Our own scene rows are ignored when deciding that a gossip option is `kept`. A script of any other tag, or none, still freezes the option.
- Database rows are never edited or deleted. Our ids avoid every id any other row of the NPC uses (the database's, fights', patrols', quest scenes'), through one allocator.
- Error codes: `NPC_SCENE_QUEST_NEEDED`, `NPC_SCENE_OPTION_GONE`, `NPC_SCENE_OPTION_LOCKED`, `NPC_SCENE_ESCORT`, `NPC_SCENE_ID_DUPLICATE`, `NPC_SCENE_LIMIT`. Warning codes: `NPC_SCENES_LOCKED`, `NPC_SCENE_QUEST_UNKNOWN`, `NPC_SCENE_NO_STEPS`. Plus every check quest scenes already have, with the owner fixed.
- Plain language in the UI: "scene", "trigger", "step", not SmartAI terms. Scripts tab is the ninth tab, after Gossip. Menu section: **Add script…** / **Edit scripts…** (hint: the number of scenes).
- Commit messages: conventional style, no attribution lines. Run `npm test` and `npm run typecheck` before each commit that touches shared types. Source edits via the Edit tool.

## Review Focus

Inputs most likely to bite that no single spec bullet pins; each gets a named test in the task that owns the code.
1. An existing NPC with hundreds of SmartAI rows and linked chains: our ids must not land inside a chain (Task 2).
2. An NPC with another `AIName` or a `ScriptName`: nothing written, a clear warning (Tasks 2 and 5).
3. Removing a scene, or the last scene: its rows (including conditions and waypoints) are deleted, `AIName` left as it was (Task 3).
4. A scene whose quest is later deleted from the project: still compiles from its id, warning only (Tasks 2 and 5).
5. A `gossipPicked` option the author removes, copies ("Give it its own copy"), or whose menu becomes locked: the scene is flagged, never silently kept pointing at nothing (Task 5).

Also pinned: two scenes with the same trigger run in list order (Task 2); escort path ids clear of the database's and the quest scenes' (Task 2); fight, patrol and scenes on one NPC share no id, list or text group (Task 3).

## File Structure

- Model and tags: `src/core/scripts/npc-scenes.ts` (create), `src/core/scripts/model.ts` (export the shared schemas), `src/core/scripts/tag.ts`, `src/core/scripts/describe.ts`, `src/core/entities/model.ts`.
- Compiling: `src/core/scripts/compile.ts` (extract the shared per-scene body), `src/core/scripts/npc-compile.ts` (create), `src/core/scripts/context.ts`, `src/main/api/patches.ts`.
- Existing NPCs: `src/core/entities/from-rows.ts`, `src/core/entities/existing.ts`, `src/main/entities/existing.ts`, `src/main/api/entities-api.ts`.
- Checks: `src/core/scripts/npc-validate.ts` (create), `src/core/entities/validate.ts`, `src/main/api/checks.ts`.
- MCP and docs: `src/core/authoring/models.ts`, `guides.ts`, `examples.ts`, `src/main/mcp/tools/*`, `site/src/content/docs/guides/*`.
- UI: `src/renderer/entities/npc/ScriptsTab.tsx` (create), `NpcSceneCard.tsx` (create), `src/renderer/scripts/TriggerEditor.tsx`, `src/renderer/entities/GossipTab.tsx`, `NpcEditor.tsx`.
- Menu: `src/renderer/world3d/menu/sections/scripts.ts` (create), `subject.ts`.

---

### Task 1: The model, the tags, and the words for a scene

**Files:**
- Create: `src/core/scripts/npc-scenes.ts`
- Modify: `src/core/scripts/model.ts` (export `triggerSchema`, `gateSchema`, `stepSchema`), `src/core/scripts/tag.ts`, `src/core/scripts/describe.ts` (`describeTrigger` accepts the NPC trigger), `src/core/entities/model.ts` (`scenes` on `npcFields`, `newNpc`, `origin` fields)
- Test: `tests/core/npc-scenes-model.test.ts`, `tests/core/npc-scenes-tag.test.ts` (create); extend `tests/core/entities-model.test.ts` only if an existing assertion lists every NPC key

**Interfaces:**
- Produces (`npc-scenes.ts`): `NPC_SCENE_LIMIT = 32`; `npcSceneSchema`; types `NpcScene`, `NpcTrigger`, `NpcTriggerKind`; `NPC_TRIGGER_KINDS: readonly NpcTriggerKind[]` (the ten kinds above, in the order the editor lists them: `talkedTo, gossipOption, gossipPicked, spellHit, playerNear, dies, summoned, signal, waypointReached, questAccepted, questHandedIn`); `blankNpcScene(id: string): NpcScene` (`{ id, name: '', questId: 0, trigger: { kind: 'talkedTo' }, gates: [], steps: [] }`); `needsQuest(scene: NpcScene): boolean` (true when the trigger is `questAccepted`/`questHandedIn`, any step is `credit`/`eventCredit`/`failQuest`, or any gate is a quest gate with `questId` 0); `nextNpcSceneId(scenes: readonly { id: string }[]): string` (same rule as `nextSceneId`); `scenesLocked(row: { AIName?: string | null; ScriptName?: string | null } | undefined): boolean` (false for no row; true when `AIName` is non-empty and not `SmartAI`, or `ScriptName` is non-empty).
- Produces (`tag.ts`): `entitySceneTag(entry: number, sceneId: string): string` = `AQC npc<entry> <sceneId>`; `npcSceneIdOf(comment, entry): string | null`; `npcRowOwner(comment, kind: 'fight' | 'patrol' | 'scene'): number | null` (the legacy quest-tag fallback applies to `fight` and `patrol` only); `npcTriggerComment(entry: number, scene: NpcScene): string` = `` `${entitySceneTag(entry, scene.id)}: ${describeTrigger(scene.trigger)} #aqc=${JSON.stringify(scene)}` ``; `npcSceneFromComment(comment): NpcScene | null` (null for a quest scene's comment, for missing or damaged data).
- Produces (`entities/model.ts`): `CustomNpc.scenes: NpcScene[]` (`.default([])`; `newNpc(entry).scenes === []`); the existing-origin schema gains `databaseScripts: int.min(0).optional()` and `'scenes'` in the `locked` enum; `EntityLock` gains `'scenes'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/npc-scenes-model.test.ts
import { describe, expect, it } from 'vitest';
import { NPC_SCENE_LIMIT, NPC_TRIGGER_KINDS, blankNpcScene, needsQuest, nextNpcSceneId, npcSceneSchema, scenesLocked } from '../../src/core/scripts/npc-scenes';
import { sceneSchema } from '../../src/core/scripts/model';
import { newNpc, readProjectEntities } from '../../src/core/entities/model';

describe('NPC scenes', () => {
  it('parses a scene with a quest and a gossipPicked trigger', () => {
    const scene = { id: 's1', name: 'Thanks', questId: 60001, trigger: { kind: 'gossipPicked', menuId: 5, optionId: 0 }, gates: [], steps: [{ kind: 'say', text: 'Hi', style: 'say', waitMs: 0 }] };
    expect(npcSceneSchema.parse(scene)).toEqual(scene);
  });
  it('rejects a negative quest id and a scene with an owner it does not have', () => {
    expect(npcSceneSchema.safeParse({ ...blankNpcScene('s1'), questId: -1 }).success).toBe(false);
    expect(sceneSchema.safeParse(blankNpcScene('s1')).success).toBe(false);
  });
  it('lists no area trigger among the triggers an NPC can have', () => {
    expect(NPC_TRIGGER_KINDS).not.toContain('enterArea');
    expect(NPC_TRIGGER_KINDS).toContain('gossipPicked');
    expect(NPC_SCENE_LIMIT).toBe(32);
  });
  it('needs a quest for a quest trigger, a quest step, or a "this quest" gate, and not otherwise', () => {
    const base = blankNpcScene('s1');
    expect(needsQuest(base)).toBe(false);
    expect(needsQuest({ ...base, trigger: { kind: 'questHandedIn' } })).toBe(true);
    expect(needsQuest({ ...base, steps: [{ kind: 'failQuest', waitMs: 0 }] })).toBe(true);
    expect(needsQuest({ ...base, gates: [{ kind: 'quest', questId: 0, state: 'handedIn', negate: false }] })).toBe(true);
    expect(needsQuest({ ...base, gates: [{ kind: 'quest', questId: 7, state: 'handedIn', negate: false }] })).toBe(false);
  });
  it('hands out the next id past the highest in use, never a lower freed one', () => {
    expect(nextNpcSceneId([])).toBe('s1');
    expect(nextNpcSceneId([{ id: 's1' }, { id: 's4' }])).toBe('s5');
  });
  it('locks an NPC that runs another AI or a C++ script, and not one that has none or SmartAI', () => {
    expect(scenesLocked(undefined)).toBe(false);
    expect(scenesLocked({ AIName: '', ScriptName: '' })).toBe(false);
    expect(scenesLocked({ AIName: 'SmartAI', ScriptName: '' })).toBe(false);
    expect(scenesLocked({ AIName: 'NullCreatureAI', ScriptName: '' })).toBe(true);
    expect(scenesLocked({ AIName: '', ScriptName: 'boss_x' })).toBe(true);
  });
  it('gives a new NPC no scenes and loads an old NPC saved without the key', () => {
    expect(newNpc(12000001).scenes).toEqual([]);
    const { scenes: _drop, ...old } = newNpc(12000001);
    expect(readProjectEntities({ npcs: [old], objects: [], items: [] }).npcs[0]!.scenes).toEqual([]);
  });
});
```

```ts
// tests/core/npc-scenes-tag.test.ts
import { describe, expect, it } from 'vitest';
import { entitySceneTag, npcRowOwner, npcSceneFromComment, npcSceneIdOf, npcTriggerComment, sceneFromComment, triggerComment } from '../../src/core/scripts/tag';
import { blankNpcScene } from '../../src/core/scripts/npc-scenes';

const scene = { ...blankNpcScene('s2'), name: 'Hello', steps: [{ kind: 'emote' as const, emote: 1, waitMs: 0 }] };

describe('NPC scene tags', () => {
  it('tags a scene row by NPC and scene', () => {
    expect(entitySceneTag(12000001, 's2')).toBe('AQC npc12000001 s2');
  });
  it('finds the owner of a scene row, and not of a fight, patrol, quest-scene or lookalike row', () => {
    expect(npcRowOwner('AQC npc12000001 s2: When a player talks', 'scene')).toBe(12000001);
    expect(npcRowOwner('AQC npc12000001 s12', 'scene')).toBe(12000001);
    expect(npcRowOwner('AQC npc12000001 fight: x', 'scene')).toBeNull();
    expect(npcRowOwner('AQC npc12000001 sx', 'scene')).toBeNull();
    expect(npcRowOwner('AQC q60001 s2', 'scene')).toBeNull();
    expect(npcRowOwner('AQC npc12000001 s2', 'fight')).toBeNull();
  });
  it('keeps NPC 1200 from claiming NPC 12000\'s rows', () => {
    expect(npcSceneIdOf('AQC npc12000 s1: x', 1200)).toBeNull();
    expect(npcSceneIdOf('AQC npc1200 s1: x', 1200)).toBe('s1');
  });
  it('round-trips a scene through the trigger row\'s comment', () => {
    expect(npcSceneFromComment(npcTriggerComment(12000001, scene))).toEqual(scene);
  });
  it('does not mistake a quest scene\'s comment for an NPC scene, or the reverse', () => {
    const questScene = { id: 's1', name: '', owner: { kind: 'creature' as const, entry: 5 }, trigger: { kind: 'dies' as const }, gates: [], steps: [] };
    expect(npcSceneFromComment(triggerComment(60001, questScene))).toBeNull();
    expect(sceneFromComment(npcTriggerComment(12000001, scene))).toBeNull();
    expect(npcSceneFromComment('AQC npc1 s1: damaged #aqc={')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/npc-scenes-model.test.ts tests/core/npc-scenes-tag.test.ts`
Expected: FAIL (modules and exports missing).

- [ ] **Step 3: Implement**

Export the three schemas from `model.ts` without changing `sceneSchema`. `npc-scenes.ts` builds `npcSceneSchema` from them: the trigger is `z.union` of `triggerSchema` and `{ kind: 'gossipPicked', menuId: int, optionId: int }` (the NPC trigger type is the quest `SceneTrigger` plus that shape). `describeTrigger` gains a `gossipPicked` case returning `` `When a player picks option ${optionId} of menu ${menuId}` `` and its parameter type widens to the NPC trigger; `describeScene` stays for quest scenes. In `tag.ts`, `npcRowOwner` keeps its present behaviour for `fight` and `patrol` and adds `scene`; `npcSceneFromComment` parses the text after the last ` #aqc=` with `npcSceneSchema.safeParse` inside try/catch, returning null on any failure (mirror `sceneFromComment`). In `entities/model.ts` add the `scenes` field with a comment naming this spec, the two origin changes, and the `EntityLock` member. Nothing else reads these yet.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core/npc-scenes-model.test.ts tests/core/npc-scenes-tag.test.ts tests/core/entity-tags.test.ts tests/core/entities-model.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/scripts src/core/entities/model.ts tests/core
git commit -m "feat(scripts): NPC scene model, tags and trigger wording"
```

---

### Task 2: Compiling an NPC's scenes

**Files:**
- Create: `src/core/scripts/npc-compile.ts`
- Modify: `src/core/scripts/compile.ts` (extract the shared per-scene body; `compileScenes` keeps its signature and output)
- Test: `tests/core/npc-scenes-compile.test.ts` (create); the whole existing `tests/core/scripts-compile*.test.ts` family must still pass unchanged (find them with `ls tests/core | grep -i scene\|script`)

**Interfaces:**
- Consumes: `compileScenes`, `CompiledScripts`, `mergeCompiled` (`compile.ts`); `ScriptContext`, `EMPTY_SCRIPT_CONTEXT` (`context.ts`); `CustomNpc`; `ProjectGossip`; Task 1's tags and `scenesLocked`.
- Produces: `compileNpcScenes(input: { npcs: readonly CustomNpc[]; objectives: ReadonlyMap<number, readonly number[]>; context: ScriptContext; taken?: CompiledScripts; gossip?: ProjectGossip }): CompiledScripts`. `objectives` maps a quest id to its four `RequiredNpcOrGo` entries (index 0 is objective 1), as `compileFights` takes it.

Behavior:
1. **Extraction (no behaviour change).** The body of `compileOne` and the surrounding delete/allocator/path logic in `compileScenes` becomes an internal function parameterised by a scope: how a scene is tagged (`tagOf(scene)`), which comments are "ours" and which scene id they carry (`sceneIdOf(comment)`), the quest id used by each scene (`questOf(scene)`; the quest's own id for quest scenes, `scene.questId` for NPC scenes) and the objectives for it. The shared body works on a normalised scene: owner kind `creature` with the NPC's entry, trigger, gates, steps. `compileScenes` builds the quest scope; `compileNpcScenes` builds the NPC scope. Every existing scene test passes unchanged — that is this step's proof.
2. **NPC scope.** For each NPC with scenes (and for every NPC in `npcs` for deletes): rows of the NPC (`context.smartScripts`, `creatureText`, `conditions`, `waypoints`) whose comment satisfies `npcRowOwner(comment, 'scene') === entry` are the NPC's own and are deleted (by primary key, as quest scenes do) and excluded from the allocator; rows of other tags, and the database's rows, are never deleted and are kept in the allocator, together with `taken`'s inserts. A scene whose trigger row carries `#aqc=` data that no longer parses is protected like a quest scene (its rows are left, with a warning).
3. **Locked.** When `scenesLocked(row)` is true for the NPC's `context.creatures` row, or `origin.locked` includes `'scenes'`, nothing is written for that NPC (no deletes either) and no warning is added here (Task 5 warns).
4. **Quests.** `questAccepted` uses event `EVENT.acceptedQuest` with `scene.questId`, `questHandedIn` uses `EVENT.rewardQuest`; `credit` reads `objectives.get(scene.questId)`; `eventCredit`, `failQuest` and `startEscort`'s quest param use `scene.questId`; a quest gate with `questId` 0 uses `scene.questId`. A scene that `needsQuest` with `questId` 0 is skipped with the warning `NPC <entry> scene <id> needs a quest, so it was not written.`. A quest absent from the project still compiles from its id.
5. **gossipPicked.** Event `[EVENT.gossipSelect, menuId, optionId]` on the NPC; no `gossip_menu`, `gossip_menu_option` or `npc_text` row; no option condition (the gates go on the trigger row only).
6. **AIName.** As quest scenes do: one `creature_template` update `{ AIName: 'SmartAI' }` with `onlyIf: { AIName: '' }` per NPC written, only when the NPC's context row is absent or not already `SmartAI`. Removing the last scene writes deletes only and no update.
7. **Order.** Scenes of an NPC compile in list order, so two scenes with the same trigger get rows in list order and both run.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/npc-scenes-compile.test.ts
import { describe, expect, it } from 'vitest';
import { compileNpcScenes } from '../../src/core/scripts/npc-compile';
import { EMPTY_SCRIPT_CONTEXT } from '../../src/core/scripts/context';
import { blankNpcScene, type NpcScene } from '../../src/core/scripts/npc-scenes';
import { newNpc } from '../../src/core/entities/model';
import { EVENT } from '../../src/core/smartai/ids';

const NONE = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
const say = (text: string) => ({ kind: 'say' as const, text, style: 'say' as const, waitMs: 0 });
const scene = (id: string, over: Partial<NpcScene> = {}): NpcScene => ({ ...blankNpcScene(id), steps: [say('Hi')], ...over });
const npcWith = (scenes: NpcScene[], entry = 12000001) => ({ ...newNpc(entry), name: 'Hela', scenes });
const compile = (npcs: ReturnType<typeof npcWith>[], context = EMPTY_SCRIPT_CONTEXT, extra = {}) =>
  compileNpcScenes({ npcs, objectives: new Map(), context, taken: NONE, ...extra });
const smart = (out: ReturnType<typeof compile>) => out.inserts.smart_scripts ?? [];

describe('compiling NPC scenes', () => {
  it('writes a talked-to scene tagged for the NPC, with the scene as data on the trigger row', () => {
    const rows = smart(compile([npcWith([scene('s1')])]));
    expect(rows.every((r) => r.comment!.startsWith('AQC npc12000001 s1'))).toBe(true);
    expect(rows.filter((r) => r.comment!.includes(' #aqc=')).length).toBe(1);
    expect(rows[0]).toMatchObject({ entryorguid: '12000001', source_type: '0', event_type: String(EVENT.gossipHello) });
  });

  it.each([
    ['dies', { kind: 'dies' as const }],
    ['spellHit', { kind: 'spellHit' as const, spellId: 100 }],
    ['playerNear', { kind: 'playerNear' as const, range: 8 }],
    ['signal', { kind: 'signal' as const, signal: 3 }],
    ['summoned', { kind: 'summoned' as const }],
    ['talkedTo', { kind: 'talkedTo' as const }],
  ])('compiles a %s scene to rows on the NPC', (_name, trigger) => {
    const rows = smart(compile([npcWith([scene('s1', { trigger })])]));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entryorguid === '12000001' || r.source_type === '9')).toBe(true);
  });

  it('writes a gossipPicked scene as an event 62 row naming the menu and option, and no gossip rows', () => {
    const out = compile([npcWith([scene('s1', { trigger: { kind: 'gossipPicked', menuId: 55, optionId: 2 } })])]);
    const trigger = smart(out).find((r) => r.event_type === '62')!;
    expect(trigger).toMatchObject({ event_param1: '55', event_param2: '2', source_type: '0' });
    expect(out.inserts.gossip_menu).toBeUndefined();
    expect(out.inserts.gossip_menu_option).toBeUndefined();
    expect(out.inserts.npc_text).toBeUndefined();
  });

  it('uses the scene\'s quest for quest triggers, objective credit and "this quest" gates', () => {
    const quest = scene('s1', {
      questId: 60002, trigger: { kind: 'questHandedIn' },
      gates: [{ kind: 'quest', questId: 0, state: 'handedIn', negate: false }],
      steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }],
    });
    const out = compile([npcWith([quest])], EMPTY_SCRIPT_CONTEXT, { objectives: new Map([[60002, [1423, 0, 0, 0]]]) });
    expect(smart(out).some((r) => r.event_param1 === '60002')).toBe(true);
    expect(smart(out).some((r) => r.action_param1 === '1423')).toBe(true);
    expect(out.inserts.conditions![0]).toMatchObject({ ConditionValue1: '60002' });
  });

  it('skips a scene that needs a quest and has none, with a warning', () => {
    const out = compile([npcWith([scene('s1', { trigger: { kind: 'questAccepted' } })])]);
    expect(smart(out)).toEqual([]);
    expect(out.warnings).toEqual(['NPC 12000001 scene s1 needs a quest, so it was not written.']);
  });

  it('still compiles a scene whose quest is not in the project', () => {
    const out = compile([npcWith([scene('s1', { questId: 99999, trigger: { kind: 'questAccepted' } })])]);
    expect(smart(out).some((r) => r.event_param1 === '99999')).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it('sets SmartAI only where the AI is empty, and not at all for the last scene removed', () => {
    const withAi = (AIName: string) => ({ ...EMPTY_SCRIPT_CONTEXT, creatures: [{ entry: '12000001', npcflag: '0', gossip_menu_id: '0', AIName, ScriptName: '' }] });
    expect(compile([npcWith([scene('s1')])], withAi('')).updates).toEqual([{ table: 'creature_template', key: { entry: '12000001' }, set: { AIName: 'SmartAI' }, onlyIf: { AIName: '' } }]);
    expect(compile([npcWith([scene('s1')])], withAi('SmartAI')).updates).toEqual([]);
    expect(compile([npcWith([])], withAi('')).updates).toEqual([]);
  });

  it('writes nothing for an NPC that runs another AI or a C++ script, nor deletes anything', () => {
    const own = { entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '4', comment: 'AQC npc12000001 s1: old' };
    for (const row of [{ AIName: 'NullCreatureAI', ScriptName: '' }, { AIName: '', ScriptName: 'boss_x' }]) {
      const context = { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [own], creatures: [{ entry: '12000001', npcflag: '0', gossip_menu_id: '0', ...row }] };
      const out = compile([npcWith([scene('s1')])], context);
      expect(out.inserts).toEqual({});
      expect(out.deletes).toEqual({});
      expect(out.updates).toEqual([]);
    }
  });

  it('writes nothing for an NPC whose origin locks its scenes', () => {
    const npc = { ...npcWith([scene('s1')]), origin: { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, locked: ['scenes' as const] } };
    expect(smart(compile([npc]))).toEqual([]);
  });

  it('takes ids clear of the database\'s rows and a linked chain on an NPC with hundreds of them', () => {
    const database = Array.from({ length: 300 }, (_, i) => ({ entryorguid: '12000001', source_type: '0', id: String(i), link: i % 2 === 0 ? String(i + 1) : '0', event_type: i % 2 === 0 ? '1' : '61', comment: '' }));
    const rows = smart(compile([npcWith([scene('s1'), scene('s2', { trigger: { kind: 'dies' } })])], { ...EMPTY_SCRIPT_CONTEXT, smartScripts: database }));
    const mine = rows.filter((r) => r.source_type === '0').map((r) => Number(r.id));
    expect(mine.every((id) => id >= 300)).toBe(true);
    expect(new Set(mine).size).toBe(mine.length);
  });

  it('deletes only its own tagged rows, never a database row or a fight\'s', () => {
    const context = { ...EMPTY_SCRIPT_CONTEXT, smartScripts: [
      { entryorguid: '12000001', source_type: '0', id: '0', link: '0', event_type: '1', comment: '' },
      { entryorguid: '12000001', source_type: '0', id: '1', link: '0', event_type: '4', comment: 'AQC npc12000001 fight: x' },
      { entryorguid: '12000001', source_type: '0', id: '2', link: '0', event_type: '1', comment: 'AQC npc12000001 s1: old #aqc={}' },
    ] };
    const out = compile([npcWith([])], context);
    expect(out.deletes.smart_scripts).toEqual([{ entryorguid: '12000001', source_type: '0', id: '2', link: '0' }]);
  });

  it('gives two scenes with the same trigger separate rows in list order', () => {
    const rows = smart(compile([npcWith([scene('s1', { steps: [say('first')] }), scene('s2', { steps: [say('second')] })])]));
    const ids = rows.filter((r) => r.comment!.includes(' #aqc=')).map((r) => [r.comment!.slice(0, 18), Number(r.id)] as const);
    expect(ids.map(([tag]) => tag)).toEqual(['AQC npc12000001 s1', 'AQC npc12000001 s2']);
    expect(ids[0]![1]).toBeLessThan(ids[1]![1]);
  });

  it('keeps an escort\'s path id clear of the database\'s and of the rows already taken', () => {
    const escort = scene('s1', { steps: [{ kind: 'startEscort', points: [{ x: 1, y: 1, z: 1, o: 0 }], run: false, waitMs: 0 }] });
    const out = compile([npcWith([escort])], { ...EMPTY_SCRIPT_CONTEXT, waypointsMax: 777 });
    expect(out.inserts.waypoints![0]).toMatchObject({ entry: '778' });
    expect(out.inserts.waypoints![0]!.point_comment).toMatch(/^AQC npc12000001 s1/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/npc-scenes-compile.test.ts`
Expected: FAIL ("compileNpcScenes is not a function").

- [ ] **Step 3: Implement**

Do step 1 of the behavior list first and run the existing scene tests green before adding NPC scope (`npx vitest run tests/core -t scene`). Then write `npc-compile.ts` to the behavior above. `compileNpcScenes` returns one `CompiledScripts` for all NPCs (merge per NPC with `mergeCompiled`, or accumulate in one output, but keep deletes sorted and deduplicated as `compileScenes` does).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core && npm run typecheck`
Expected: PASS (existing quest-scene tests included).

- [ ] **Step 5: Commit**

```bash
git add src/core/scripts tests/core
git commit -m "feat(scripts): compile NPC-owned scenes with the quest scene compiler"
```

---

### Task 3: Wiring scenes into the project patch

**Files:**
- Modify: `src/core/scripts/context.ts` (read the NPC-tagged conditions and waypoints), `src/main/api/patches.ts` (`projectScripts`: scenes after fights and patrols; quest compile sees them as `taken`; objectives), `src/main/api/context.ts` only if it must expose quest objectives (it already has `objectivesByQuest`)
- Test: `tests/core/npc-scenes-context.test.ts` (create), `tests/main/api-npc-scenes-export.test.ts` (create, modelled on the nearest existing export test: `ls tests/main | grep -i "export\|patch\|gossip"`)

**Interfaces:**
- Consumes: `compileNpcScenes` (Task 2), `objectivesByQuest()`, `readScriptContext(db, 0, [], npcs.map(n => n.entry))`.
- Produces: `readScriptContext` also reads, when `extraCreatures` is non-empty, `conditions` rows whose `Comment` starts `AQC npc` and `waypoints` rows whose `point_comment` starts `AQC npc` (one prefix query each, via `prefixedRows`), keeping only rows whose `npcRowOwner(…, 'scene')` is one of `extraCreatures`. `projectScripts` returns fights + patrols + scenes merged; the revert patch deletes the scene rows the export inserted, like the other script rows.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/npc-scenes-context.test.ts — uses the same fake database the other context tests use (find: tests/core/scripts-context*.test.ts)
import { describe, expect, it } from 'vitest';
import { readScriptContext } from '../../src/core/scripts/context';

describe('reading the context of NPC scenes', () => {
  it('reads the NPC\'s tagged conditions and waypoints, and not another NPC\'s or a quest\'s', async () => {
    // build the fake db with: conditions rows commented 'AQC npc100 s1: x', 'AQC npc200 s1: x', 'AQC q5 s1: x';
    // waypoints rows with point_comment 'AQC npc100 s1: point 1' and 'AQC npc200 s1: point 1'
    // (copy the fixture-building helper from the neighbouring context test)
    const context = await readScriptContext(db, 0, [], [100]);
    expect(context.conditions.map((r) => r.Comment)).toEqual(['AQC npc100 s1: x']);
    expect(context.waypoints.map((r) => r.point_comment)).toEqual(['AQC npc100 s1: point 1']);
  });
  it('reads nothing extra when there are no extra creatures', async () => {
    expect((await readScriptContext(db, 0, [], [])).conditions).toEqual([]);
  });
});
```

(The first block must be completed with the neighbouring test's real fixture helper; the plan fixes the assertions, not the helper name.)

```ts
// tests/main/api-npc-scenes-export.test.ts — mirror the project-export test that already asserts fight rows appear in the patch
it('exports an NPC\'s scenes in the project patch and reverts them', async () => {
  // project with one new NPC (12000001) holding scene s1 { talkedTo, say 'Hi' }
  const patch = await exportProject();             // use the neighbour's helper
  const inserts = patch.apply.filter((s) => s.kind === 'insert' && s.table === 'smart_scripts');
  expect(inserts.length).toBeGreaterThan(0);
  expect(inserts.every((s) => String(s.row.comment).startsWith('AQC npc12000001 s1'))).toBe(true);
  const text = patch.apply.find((s) => s.kind === 'insert' && s.table === 'creature_text');
  expect(text).toBeDefined();
  expect(patch.revert.filter((s) => s.kind === 'delete' && s.table === 'smart_scripts').length).toBe(inserts.length);
});

it('deletes the rows of a scene since removed, conditions and waypoints too, and leaves AIName alone', async () => {
  // fake db already holds smart_scripts/conditions/waypoints/creature_text tagged 'AQC npc12000001 s1', creature_template AIName 'SmartAI';
  // project NPC 12000001 now has scenes: []
  const patch = await exportProject();
  const deletes = patch.apply.filter((s) => s.kind === 'delete').map((s) => s.table);
  expect(deletes).toEqual(expect.arrayContaining(['smart_scripts', 'conditions', 'waypoints', 'creature_text']));
  expect(patch.apply.some((s) => s.kind === 'update' && s.table === 'creature_template')).toBe(false);
});

it('keeps a quest\'s scenes, a fight and an NPC\'s scenes on one NPC off each other\'s ids, lists and text groups', async () => {
  // NPC 12000001: a fight with a say reaction, a patrol point with a say, scene s1 with a say and a 2-step wait,
  // and a quest scene owned by creature 12000001
  const rows = (await exportProject()).apply.filter((s) => s.kind === 'insert' && s.table === 'smart_scripts').map((s) => s.row);
  const keys = rows.map((r) => `${r.entryorguid}/${r.source_type}/${r.id}/${r.link}`);
  expect(new Set(keys).size).toBe(keys.length);
  const texts = (await exportProject()).apply.filter((s) => s.kind === 'insert' && s.table === 'creature_text').map((s) => `${s.row.CreatureID}/${s.row.GroupID}/${s.row.ID}`);
  expect(new Set(texts).size).toBe(texts.length);
});
```

(These three blocks are written against the neighbouring export test's helpers; copy its setup verbatim, then the assertions above are exact.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/npc-scenes-context.test.ts tests/main/api-npc-scenes-export.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `readScriptContext`, add the NPC-tag reads described above and merge them into `conditions` and `waypoints` through the existing `unique`. In `projectScripts`, after fights and patrols, call `compileNpcScenes({ npcs, objectives: objectivesByQuest(), context, taken: mergeCompiled(fights, patrols), gossip: projectGossip(npcs) })` and merge it last. The revert loop already derives deletes from the inserted `smart_scripts`, `creature_text`, `conditions` and `waypoints` rows by `SCRIPT_KEYS`; check that `conditions` and `waypoints` keys are present there (they are) and that nothing else filters them out. `compileFor` already takes `project.compiled` as `taken`, so quest scenes keep off the NPC scenes' ids.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core tests/main && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/scripts/context.ts src/main/api/patches.ts tests
git commit -m "feat(scripts): export NPC scenes in the project patch with a revert"
```

---

### Task 4: Existing NPCs: what is read, what is locked, what is ours

**Files:**
- Modify: `src/core/entities/from-rows.ts` (`ExistingCounts`, `npcFromRows`, `gossipOf` kept test), `src/core/entities/existing.ts` (original rows; the kept-script query keeps returning our rows but they are ignored), `src/main/entities/existing.ts` and `src/main/api/entities-api.ts` (counts, tagged scenes on open), `src/core/scripts/decompile.ts` only if a helper is shared
- Test: `tests/core/entities-scenes-read.test.ts` (create); extend `tests/main/api-existing.test.ts`

**Interfaces:**
- Consumes: Task 1 (`origin.databaseScripts`, `'scenes'` lock, tags), `scenesLocked`.
- Produces: `ExistingCounts` gains `databaseScripts?: number`, `scriptsLocked?: boolean` and `scenes?: readonly NpcScene[]`. `npcFromRows(entry, original, counts)` sets `origin.databaseScripts = counts.databaseScripts ?? 0`, adds `'scenes'` to `origin.locked` when `counts.scriptsLocked`, and always returns `scenes: []` (Put back as the database has it therefore drops them). The main process, **only when it first brings an existing NPC into the project** (find where it calls `npcFromRows` in `entities-api.ts`), sets `scenes` to `counts.scenes`: the scenes read back from the NPC's tagged trigger rows (`npcSceneFromComment` of every `smart_scripts` row whose `npcRowOwner(comment,'scene') === entry` and whose comment carries data), ordered by scene id number. `databaseScripts` = rows of `smart_scripts` with `source_type` 0 and `entryorguid` = entry whose comment does not start `entityTag('npc', entry)` (the NPC's own tag), plus none from timed lists.
- `gossipOf`'s `tied` test ignores a script whose comment starts with `entityTag('npc', entry)` + `s` followed by a digit (our scene rows), still counting any other script, tagged or not.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-scenes-read.test.ts
import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { blankNpcScene } from '../../src/core/scripts/npc-scenes';

const creature = { entry: '100', name: 'Old', gossip_menu_id: '5', npcflag: '1', AIName: 'SmartAI', ScriptName: '' };
const rows = (scripts: Record<string, string>[]) => ({
  creature_template: [creature],
  gossip_menu: [{ MenuID: '5', TextID: '9' }],
  gossip_menu_option: [{ MenuID: '5', OptionID: '0', OptionIcon: '0', OptionText: 'Hi', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' }],
  npc_text: [{ ID: '9', text0_0: 'Hello', Probability0: '1' }],
  smart_scripts: scripts,
});
const select = (comment: string) => ({ entryorguid: '100', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '5', event_param2: '0', comment });
const optionOf = (npc: ReturnType<typeof npcFromRows>) => npc.gossipMenu!.menus[0]!.options[0]!;

describe('existing NPCs and scenes', () => {
  it('does not freeze an option because one of our own scenes hangs off it', () => {
    expect(optionOf(npcFromRows(100, rows([select('AQC npc100 s1: When a player picks option 0 of menu 5')]), {})).kept).toBe(false);
  });
  it('still freezes an option a database script, or another tag, names', () => {
    expect(optionOf(npcFromRows(100, rows([select('')]), {})).kept).toBe(true);
    expect(optionOf(npcFromRows(100, rows([select('AQC npc100 fight: x')]), {})).kept).toBe(true);
    expect(optionOf(npcFromRows(100, rows([select('AQC npc1000 s1: x')]), {})).kept).toBe(true);
  });
  it('records how many scripts the database runs and locks the scenes of an NPC that runs something else', () => {
    const npc = npcFromRows(100, rows([]), { databaseScripts: 4, scriptsLocked: true });
    expect(npc.origin).toMatchObject({ kind: 'existing', databaseScripts: 4 });
    expect((npc.origin as { locked: string[] }).locked).toContain('scenes');
    expect(npcFromRows(100, rows([]), {}).scenes).toEqual([]);
  });
  it('starts a put-back NPC with no scenes even when the counts carry some', () => {
    expect(npcFromRows(100, rows([]), { scenes: [blankNpcScene('s1')] }).scenes).toEqual([]);
  });
});
```

Extend `tests/main/api-existing.test.ts` with one test: with the fake database holding two database `smart_scripts` rows and three rows tagged `AQC npc<entry> s1` (one carrying `#aqc=` data), opening the NPC gives `origin.databaseScripts === 2` and `scenes` equal to the scene in the data; opening one whose `AIName` is `ReactorAI` gives `locked` including `'scenes'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/entities-scenes-read.test.ts tests/main/api-existing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

As the Interfaces block says. In `entities-api.ts` read `smart_scripts` for the entry once (`source_type` 0) and derive the three facts; keep that read out of `origin.original` (hundreds of rows must not be stored). A fork without `smart_scripts` yields zero and no lock.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core tests/main && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(scripts): read an existing NPC's script facts and take back its own scenes"
```

---

### Task 5: Validation

**Files:**
- Create: `src/core/scripts/npc-validate.ts`
- Modify: `src/core/entities/validate.ts` (call it from `entityIssues`; new input fields), `src/main/api/checks.ts` (`newEntityIssues` supplies them)
- Test: `tests/core/npc-scenes-validate.test.ts` (create), extend `tests/main/` checks test if one covers `newEntityIssues` (`grep -l newEntityIssues tests/main`)

**Interfaces:**
- Produces: `npcSceneIssues(input: { npc: CustomNpc; label: string; knownQuest: (id: number) => boolean; locked: boolean; escortOwners?: never }): Issue[]` — pure. It runs the quest-scene step checks (`incomplete` steps, unknown spell is checked by the caller, `SCENE_NO_PLAYER`, `SCENE_STEP_INCOMPLETE`) with the owner fixed to the NPC by reusing `sceneIssues` on normalised scenes where the trigger is not `gossipPicked`, and adds the codes below. `entityIssues` input gains `scriptLocked?: ReadonlySet<number>` (NPC entries whose live template runs another AI or a script, from `scenesLocked`); `newEntityIssues` fills it from the `creature_template` rows it already reads. Each issue carries `fieldId: 'scenes'` and a message prefixed with the scene label.
- Rules (exact): `NPC_SCENE_QUEST_NEEDED` error when `needsQuest(scene)` and `questId === 0`; `NPC_SCENE_QUEST_UNKNOWN` warning when `questId > 0` and `!knownQuest(questId)`; `NPC_SCENE_OPTION_GONE` error when a `gossipPicked` scene's menu is in the NPC's tree but has no such option, or the NPC has no tree; `NPC_SCENE_OPTION_LOCKED` error when the menu is not in the NPC's tree (not its own) or is `locked`, or the option is `kept`; `NPC_SCENE_ESCORT` error when `waypointReached` names a scene id that is not a scene of this NPC with a `startEscort` step; `NPC_SCENE_ID_DUPLICATE` error when two scenes share an id; `NPC_SCENE_LIMIT` error when more than 32 scenes; `NPC_SCENES_LOCKED` warning (once per NPC) when `locked` or `origin.locked` has `'scenes'` and there are scenes; `NPC_SCENE_NO_STEPS` warning for a scene with no steps. A locked NPC raises only `NPC_SCENES_LOCKED`.
- An existing NPC whose `scenes` are unchanged from `[]` raises nothing (no scenes, no issues).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/npc-scenes-validate.test.ts
import { describe, expect, it } from 'vitest';
import { npcSceneIssues } from '../../src/core/scripts/npc-validate';
import { blankNpcScene, type NpcScene } from '../../src/core/scripts/npc-scenes';
import { newNpc, type GossipMenu } from '../../src/core/entities/model';

const say = { kind: 'say' as const, text: 'Hi', style: 'say' as const, waitMs: 0 };
const scene = (id: string, over: Partial<NpcScene> = {}): NpcScene => ({ ...blankNpcScene(id), steps: [say], ...over });
const menu = (over: Partial<GossipMenu> = {}): GossipMenu => ({
  menuId: 5, textId: 9, locked: false, greeting: [{ text: 'x', textFemale: '', probability: 1 }],
  options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false }], ...over,
});
const run = (scenes: NpcScene[], opts: { tree?: GossipMenu[] | null; known?: number[]; locked?: boolean } = {}) =>
  npcSceneIssues({
    npc: { ...newNpc(12000001), scenes, gossipMenu: opts.tree ? { menus: opts.tree } : null },
    label: 'NPC "Hela"', knownQuest: (id) => (opts.known ?? []).includes(id), locked: opts.locked ?? false,
  }).map((i) => `${i.severity}:${i.code}`);
const picked = (menuId = 5, optionId = 0) => scene('s1', { trigger: { kind: 'gossipPicked', menuId, optionId } });

describe('NPC scene checks', () => {
  it('is quiet for a plain scene, and for an NPC with none', () => {
    expect(run([scene('s1')])).toEqual([]);
    expect(run([])).toEqual([]);
  });
  it('needs a quest for a quest trigger, and warns about a quest nobody knows', () => {
    expect(run([scene('s1', { trigger: { kind: 'questHandedIn' } })])).toContain('error:NPC_SCENE_QUEST_NEEDED');
    expect(run([scene('s1', { questId: 7 })], { known: [7] })).toEqual([]);
    expect(run([scene('s1', { questId: 7 })])).toEqual(['warning:NPC_SCENE_QUEST_UNKNOWN']);
  });
  it('flags a gossipPicked option that is gone, locked, kept, or not this NPC\'s menu', () => {
    expect(run([picked()], { tree: [menu()] })).toEqual([]);
    expect(run([picked(5, 3)], { tree: [menu()] })).toEqual(['error:NPC_SCENE_OPTION_GONE']);
    expect(run([picked()], { tree: null })).toEqual(['error:NPC_SCENE_OPTION_GONE']);
    expect(run([picked(5, 0)], { tree: [menu({ locked: true })] })).toEqual(['error:NPC_SCENE_OPTION_LOCKED']);
    expect(run([picked(5, 0)], { tree: [menu({ options: [{ optionId: 0, icon: 0, text: 'B', action: { kind: 'close' }, kept: true }] })] })).toEqual(['error:NPC_SCENE_OPTION_LOCKED']);
    expect(run([picked(77, 0)], { tree: [menu()] })).toEqual(['error:NPC_SCENE_OPTION_LOCKED']);
  });
  it('flags an escort wait that names no escort of this NPC', () => {
    const wait = scene('s2', { trigger: { kind: 'waypointReached', escortSceneId: 's1', point: 1 } });
    expect(run([scene('s1'), wait])).toContain('error:NPC_SCENE_ESCORT');
    const escort = scene('s1', { steps: [{ kind: 'startEscort', points: [{ x: 0, y: 0, z: 0, o: 0 }], run: false, waitMs: 0 }] });
    expect(run([escort, wait])).not.toContain('error:NPC_SCENE_ESCORT');
  });
  it('flags duplicate ids, too many scenes, and a scene with nothing to do', () => {
    expect(run([scene('s1'), scene('s1')])).toContain('error:NPC_SCENE_ID_DUPLICATE');
    expect(run(Array.from({ length: 33 }, (_, i) => scene(`s${i + 1}`)))).toContain('error:NPC_SCENE_LIMIT');
    expect(run([scene('s1', { steps: [] })])).toEqual(['warning:NPC_SCENE_NO_STEPS']);
  });
  it('says a locked NPC\'s scenes are not written, and nothing else about them', () => {
    expect(run([scene('s1', { trigger: { kind: 'questHandedIn' } })], { locked: true })).toEqual(['warning:NPC_SCENES_LOCKED']);
    expect(run([], { locked: true })).toEqual([]);
  });
  it('keeps the checks quest scenes have: a player step on a trigger with no player', () => {
    expect(run([scene('s1', { trigger: { kind: 'summoned' }, steps: [{ kind: 'castOnPlayer', spellId: 5, waitMs: 0 }] })])).toContain('error:SCENE_NO_PLAYER');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/npc-scenes-validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Write `npc-validate.ts` to the rules above. To reuse the quest checks without duplicating them, map each non-`gossipPicked` scene to a `QuestScene` with `owner: { kind: 'creature', entry }` and run the per-scene checks `sceneIssues` already has, dropping the ones that make no sense here (`SCENE_NO_OWNER`, `SCENE_ACCEPT_NOT_GIVER`, `SCENE_EVENT_FLAG`, `SCENE_CREDIT_EMPTY` — credit objectives are checked by `needsQuest` plus the fights' rule, not by an owner quest). If extracting a per-scene function from `sceneIssues` is cleaner than filtering, do that (`sceneIssues` behaviour must not change). A `gossipPicked` scene is mapped to `talkedTo` for these checks. In `entityIssues`, call it per NPC that has scenes (existing NPCs too), skipping NPCs whose scenes are unread (none) and passing `locked` from `scriptLocked`. In `newEntityIssues`, compute `scriptLocked` from the creature rows it already reads; collect the quest ids with `knownQuest`.

Also in `entityIssues`'s gossip section: a tree whose options are removed while a scene points at them is already reported by `NPC_SCENE_OPTION_GONE`; add one test in `tests/core/entities-gossip-validate.test.ts` that removing the option a scene hangs off, and giving the menu its own copy (`copyMenus` makes a new menu id), each yield an `NPC_SCENE_OPTION_GONE`/`NPC_SCENE_OPTION_LOCKED` error on the next validation.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core tests/main && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(scripts): checks for NPC scenes"
```

---

### Task 6: MCP authoring and the guide

**Files:**
- Modify: `src/core/authoring/models.ts` (`AUTHORING_MODELS` gains `'npc-scripts'`, with description and schema), `src/core/authoring/guides.ts`, `src/core/authoring/examples.ts`, `src/main/mcp/tools/authoring.ts` (title and description list), `src/main/mcp/tools/entities.ts` (`upsert_entity` for an NPC accepts `scenes`)
- Test: extend `tests/core/authoring-models.test.ts`, `tests/core/authoring-guides.test.ts`, `tests/core/authoring-examples.test.ts`, and the MCP tool test that covers `upsert_entity` (`grep -l upsert_entity tests/main`)

**Interfaces:**
- Produces: authoring model id `npc-scripts` whose schema is `z.array(npcSceneSchema).max(32)`; a guide covering: the scene shape, which triggers and steps need a quest, `gossipPicked`, how ids and tags work (`s<n>`, `AQC npc<entry> s<n>`), locking, and that database scripts are never edited; one worked example (a talked-to scene that says a line, and a `questHandedIn` scene with a quest) with readings. The NPC guide gets one pointer bullet to `npc-scripts`.

- [ ] **Step 1: Write the failing tests**

Add to the existing three authoring test files the assertions they already make for `gossip`, with `npc-scripts`:
- the model list contains `npc-scripts`, its schema parses its own example and rejects a scene with a negative `questId`;
- its guide mentions each of `gossipPicked`, `questId`, `locked`, `smart_scripts` (database scripts never edited) and the NPC guide mentions `npc-scripts`;
- every example validates against the schema and has a non-empty reading.

For `upsert_entity`, add one test beside the gossip one: upserting a new NPC with `scenes: [<example scene>]` stores it (`get` returns the scene), and a scene with an invalid trigger is refused with the schema's message.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/authoring-models.test.ts tests/core/authoring-guides.test.ts tests/core/authoring-examples.test.ts tests/main`
Expected: FAIL.

- [ ] **Step 3: Implement**

Follow how `gossip` was added to each of the five files. `upsert_entity` needs no new code if it validates the whole NPC through `npcSchema`; confirm by the test and extend its input description to mention `scenes`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core tests/main && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(mcp): NPC scripts authoring model and upsert support"
```

---

### Task 7: The Scripts tab, and the Gossip tab note

**Files:**
- Create: `src/renderer/entities/npc/ScriptsTab.tsx`, `src/renderer/entities/npc/NpcSceneCard.tsx`
- Modify: `src/renderer/scripts/TriggerEditor.tsx` (take an optional list of allowed kinds and an optional renderer for `gossipPicked`; the trigger label for it is "A player picks an option of its talk window"), `src/renderer/entities/npc/NpcEditor.tsx` (ninth tab after Gossip, `tab` id `scripts`), `src/renderer/entities/GossipTab.tsx` (note and no Remove for an option a scene hangs off)
- Test: `tests/renderer/entities-scripts.test.tsx` (create); extend `tests/renderer/entities-gossip.test.tsx`

**Interfaces:**
- `ScriptsTab({ npc, onChange, onTab })`: the list of scenes as `NpcSceneCard`s with **Add scene**, **Duplicate** and **Remove scene**; ids from `nextNpcSceneId`; duplicate gets a fresh id and the name `<name> (copy)`; Add is disabled at 32 with the hint "An NPC can have 32 scenes."
- `NpcSceneCard`: name, **Quest** (a select of None, each project quest, and "Other…" which shows a number field; read the project's quests from the same source `GateEditor` uses), the shared `TriggerEditor` limited to `NPC_TRIGGER_KINDS`, `GateEditor`, `StepEditor` with owner `creature`. When `needsQuest(scene)` and `questId` is 0 it shows the note "needs a quest". The shared editors take a `QuestScene`; build one view object with a creature owner for them and map edits back, as the card in `SceneCard.tsx` does.
- `gossipPicked` shows a **Menu and option** select over the NPC's own tree (every unlocked, not-kept option, labelled `<menu greeting excerpt> → <option text>`); with no tree it says "This NPC has no talk window yet." and shows **Give this NPC a gossip menu**, which calls `onTab('gossip')`.
- A locked NPC (`origin.locked` includes `'scenes'`) shows the scenes read-only (controls disabled) and the reason: "This NPC runs another AI or a script, so scenes are not written for it." An existing NPC with `origin.databaseScripts > 0` shows "The database already runs N scripts on this NPC; they are not edited here." (singular for 1).
- Gossip tab: an option some scene's `gossipPicked` names shows "Runs the scene *name*" with a button **Go to scripts** (calls `onTab('scripts')`) and its Remove button is disabled.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/renderer/entities-scripts.test.tsx — copy the harness (Live, imports, makeMockApi) from entities-gossip.test.tsx, with tab="scripts"
describe('the Scripts tab', () => {
  it('adds a scene with the next id and a talked-to trigger', async () => {
    render(<Live start={npcWith([])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add scene' }));
    expect(current.scenes).toEqual([expect.objectContaining({ id: 's1', questId: 0, trigger: { kind: 'talkedTo' } })]);
  });
  it('duplicates a scene under a fresh id and removes one', async () => {
    render(<Live start={npcWith([blank('s1', 'Hello')])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(current.scenes.map((s) => [s.id, s.name])).toEqual([['s1', 'Hello'], ['s2', 'Hello (copy)']]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove scene' })[0]!);
    expect(current.scenes.map((s) => s.id)).toEqual(['s2']);
  });
  it('stops adding at 32 scenes', () => {
    render(<Live start={npcWith(Array.from({ length: 32 }, (_, i) => blank(`s${i + 1}`)))} />);
    expect(screen.getByRole('button', { name: 'Add scene' })).toBeDisabled();
  });
  it('offers no area trigger and says "needs a quest" until a quest is chosen', async () => {
    render(<Live start={npcWith([{ ...blank('s1'), trigger: { kind: 'questHandedIn' } }])} />);
    expect(within(screen.getByRole('combobox', { name: 'When' })).queryByRole('option', { name: /enters the area/ })).toBeNull();
    expect(screen.getByText('needs a quest')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Quest' }), 'Other…');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Quest ID' }), '60001');
    expect(current.scenes[0]!.questId).toBe(60001);
    expect(screen.queryByText('needs a quest')).toBeNull();
  });
  it('picks a gossipPicked option from the NPC\'s own tree only, and not a locked or kept one', async () => {
    // tree: menu 5 unlocked with options 0 and 1 (1 kept), menu 6 locked with option 0
    // after choosing the trigger "A player picks an option…", the Menu and option select lists exactly the one pickable option
  });
  it('offers a way to the Gossip tab when the NPC has no tree', async () => {
    const onTab = vi.fn();
    // gossipPicked scene on an NPC with gossipMenu null
    await userEvent.click(screen.getByRole('button', { name: 'Give this NPC a gossip menu' }));
    expect(onTab).toHaveBeenCalledWith('gossip');
  });
  it('shows a locked NPC\'s scenes read-only with the reason', () => {
    // npc with origin.locked ['scenes'] and one scene
    expect(screen.getByText(/runs another AI or a script/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add scene' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Name (for you)' })).toBeDisabled();
  });
  it('says how many scripts the database already runs on an existing NPC', () => {
    // origin.databaseScripts 4 -> /already runs 4 scripts/, 1 -> /already runs 1 script on/
  });
});
```

```tsx
// extend tests/renderer/entities-gossip.test.tsx
it('shows which scene runs from an option, takes you to it, and does not let the option be removed', async () => {
  const onTab = vi.fn();
  // npc with menu 5 option 0 and scene s1 named 'Thanks' { gossipPicked 5/0 }
  expect(screen.getByText('Runs the scene Thanks')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Go to scripts' }));
  expect(onTab).toHaveBeenCalledWith('scripts');
  expect(screen.getByRole('button', { name: /Remove option/ })).toBeDisabled();
});
```

(The `// …` comment lines in the middle tests stand for setup the engineer copies from the harness in `entities-gossip.test.tsx`; each test's assertions are given.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/renderer/entities-scripts.test.tsx tests/renderer/entities-gossip.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

As the Interfaces block. Reuse existing classes (`entry-card`, `scene-card`, `scene-hint`) so styling needs no new CSS beyond what the tab needs; check the controls-coverage test (`tests/renderer/control-coverage.test.ts`) still passes, since new controls may need to be registered the way the Gossip tab's were.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/renderer
git commit -m "feat(renderer): Scripts tab for NPC scenes"
```

---

### Task 8: Right-click menu

**Files:**
- Create: `src/renderer/world3d/menu/sections/scripts.ts`
- Modify: `src/renderer/world3d/menu/sections/kinds.ts` / the section registry (copy how `gossip` is registered; `grep -rn "gossip" src/renderer/world3d/menu`), `src/renderer/world3d/menu/subject.ts` (`NpcSpawn.scenes: { has: boolean; count: number | null }`)
- Test: extend the menu tests that cover the gossip section (`grep -l "Add gossip menu" tests`)

**Interfaces:**
- `NpcSpawn.scenes`: for an NPC the project holds and has read, `{ has: scenes.length > 0, count: scenes.length }`; for an existing NPC not held by the project, `{ has: false, count: null }`.
- The section sits after Gossip, group `world`, NPCs only. Label **Add script…** when `!has`, **Edit scripts…** when `has`; hint `N scene` / `N scenes` when `count > 0`; action `{ kind: 'editEntity', spawn: info, tab: 'scripts' }`; an existing NPC while not connected is disabled with `NEEDS_DATABASE`.

- [ ] **Step 1: Write the failing test**

```ts
it('offers Add script… on an NPC with no scenes and Edit scripts… with a count on one that has', () => {
  expect(labelsFor(npcSubject({ scenes: { has: false, count: 0 } }))).toContain('Add script…');
  const edit = itemFor(npcSubject({ scenes: { has: true, count: 2 } }), 'Edit scripts…');
  expect(edit).toMatchObject({ hint: '2 scenes', action: { kind: 'editEntity', tab: 'scripts' } });
  expect(itemFor(npcSubject({ scenes: { has: true, count: 1 } }), 'Edit scripts…')).toMatchObject({ hint: '1 scene' });
});
it('disables the item for an existing NPC while the database is not connected, and offers none for an object', () => {
  expect(itemFor(npcSubject({ origin: 'existing' }, { connected: false }), 'Add script…')).toMatchObject({ disabledReason: NEEDS_DATABASE });
  expect(labelsFor(objectSubject())).not.toContain('Add script…');
});
```

(`npcSubject`, `labelsFor`, `itemFor` are whatever helpers the gossip menu test already uses; reuse them.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/renderer -t "script"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Mirror `sections/gossip.ts` for the section and `subject.ts:35-38` for the fact. Wherever a test builds an `NpcSpawn` literal, add the new field.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/renderer tests/world3d && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests
git commit -m "feat(world): Add script… and Edit scripts… in the right-click menu"
```

---

### Task 9: Real-database check, docs, and final verification

**Files:**
- Create: `tests/integration/scripts-read.int.test.ts` (model it on `tests/integration/gossip-read.int.test.ts`; read-only)
- Modify: `site/src/content/docs/guides/npcs-and-objects.md` (a "Scripts" section), `site/src/content/docs/guides/the-world.md` (the menu item), the database tables reference and the AI page (find them: `ls site/src/content/docs/reference site/src/content/docs/guides`; add `smart_scripts` and the `AQC npc<entry> s<n>` tag), `README.md` only if it lists tabs
- Test: the integration test; `tests/docs` for any docs lint (`ls tests/docs`)

- [ ] **Step 1: Write the integration test**

```ts
// tests/integration/scripts-read.int.test.ts (runs with `npm run test:int` against the real acore_world, read-only)
it('finds no database script that starts with the tool\'s NPC tag', async () => {
  const rows = await db.selectByPrefix('smart_scripts', 'comment', 'AQC npc');
  expect(rows).toEqual([]);
});
it('compiles a scene on each of the NPCs with the most SmartAI rows without colliding with a database key', async () => {
  // pick the 5 creature entries with the most source_type 0 rows; for each build a new-NPC-shaped project NPC with a talkedTo scene and a dies scene,
  // read the context with readScriptContext(db, 0, [], entries), compile with compileNpcScenes, and assert
  // no inserted smart_scripts key (entryorguid, source_type, id, link) equals a database row's key
});
it('still reads every database gossip-select script as keeping its option', async () => {
  // for 10 creatures that have an event 62 script with an empty comment, npcFromRows on their original rows has that option kept === true
});
it('gets a scene back from its trigger row\'s comment', async () => {
  // compile one scene, take the trigger row (the one whose comment has ' #aqc='), run npcSceneFromComment on its comment, expect toEqual the scene
});
```

(The first, second and third blocks are completed from `gossip-read.int.test.ts`'s connection and helper setup.)

- [ ] **Step 2: Write the docs**

A "Scripts" section in the NPC guide: what a scene is (plain words), the Scripts tab, picking a quest, `gossipPicked`, that an NPC that runs another AI or a script is locked, that the database's own scripts are counted and never edited, and what Put back does. The World page lists the menu item. The tables reference adds the tag next to the other `AQC` tags. Run the docs build to check links: `npm run docs:build` (see `package.json` for the exact script name) and fix any broken link.

- [ ] **Step 3: Run everything**

Run: `npm run typecheck && npm test && npm run lint` (use the scripts `package.json` defines), then `npm run test:int` if the real database is reachable.
Expected: all PASS. If the integration tests cannot run here, say so; do not claim they passed.

- [ ] **Step 4: Verify in the app**

Use the `run` skill: start the app, open an NPC, add a scene with a say step, export the project patch, and confirm the SQL has `AQC npc<entry> s1` rows and a revert that deletes them. Report what you saw.

- [ ] **Step 5: Commit**

```bash
git add tests/integration site README.md
git commit -m "docs: NPC scripts guide, tables reference and a real-database check"
```

---

## Self-review

- **Spec coverage:** model and tags (1); compiler incl. gossipPicked, AIName, locked, quest handling, ids, escorts (2); project patch, cleanup by tag, revert, one allocator (3); existing NPCs: read count, lock, own scripts not `kept`, taking scenes back, Put back (4); every validation code and the removal refusal (5); MCP, `npc-scripts` model, guide (6); Scripts tab, locked/read-only, picker, Gossip note (7); menu and `NpcSpawn.scenes` (8); real-database tests and docs (9). `allocate_ids` needs no new kind (spec): no task.
- **Decision where the spec overlaps:** `NPC_SCENE_OPTION_GONE` ("not in the NPC's tree") and `NPC_SCENE_OPTION_LOCKED` ("menu is not the NPC's own") both describe a missing menu. Task 5 resolves it: a menu absent from the tree is `LOCKED` (not its own), a menu present without that option, or no tree at all, is `GONE`.
- **Known soft spots, to confirm when executing:** the exact fixture helpers for Tasks 3, 7, 8 and 9 are named by pointing at the neighbouring tests, because they were not read while planning; where the main process first brings an existing NPC into the project (Task 4) is found by searching `entities-api.ts` for `npcFromRows`.
