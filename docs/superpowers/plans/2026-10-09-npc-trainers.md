# NPC trainers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author make any NPC (new or existing) a trainer and edit the spells it teaches, its type, its greeting and (for class trainers) its class, with shared trainers locked and copyable.

**Architecture:** `CustomNpc` gains a nullable `trainer` ({ trainerId, type, requirement, greeting, spells }). Existing NPCs read `creature_default_trainer`, `trainer` and `trainer_spell` into it (originals kept in `origin.original`) and write them back through the existing `writeTable` machinery only when changed, never touching a trainer other NPCs share. New NPCs compile the same rows. The UI is a Trainer tab built like the Vendor tab, plus a right-click section.

**Tech Stack:** TypeScript, zod, React, Electron (main/renderer), vitest (+ jsdom), MySQL world DB behind `WorldDb` (fake `forkDb()` in tests; a real `acore_world` for one integration test).

**Spec:** `docs/superpowers/specs/2026-10-09-npc-trainers-design.md`

**Base:** this plan builds on the vendors work (`feat/npc-vendors`, plan `2026-10-09-npc-vendors.md`) and reuses what it added: `vendorUnread`/`sameVendor` in `src/core/entities/model.ts`, `VendorList.tsx`/`CopyStock.tsx`, `MenuEditorTab`, `ViewCreature.npcFlags`/`SpawnInfo.npcFlags`, `NpcSpawn.vendor`, the menu `hint`, and the `forkDb()` fake. Execute on a branch cut from `feat/npc-vendors` (or from `main` once vendors is merged); do not start before one of those holds.

## Global Constraints

- Tables and columns (verified against `acore_world`, 2026-10-09): `creature_default_trainer(CreatureId PK, TrainerId)`; `trainer(Id PK, Type tinyint, Requirement mediumint, Greeting mediumtext, VerifiedBuild)`; `trainer_spell(TrainerId+SpellId PK, MoneyCost, ReqSkillLine, ReqSkillRank, ReqAbility1, ReqAbility2, ReqAbility3, ReqLevel tinyint, VerifiedBuild)`.
- `trainer.Type`: 0 class, 1 mount, 2 profession, 3 pet. `Requirement` is the class id for class trainers and 0 otherwise.
- `npcflag`: trainer bit is 16. A new NPC also gets the sub-type bit of its type: class 32; mount and profession 64; pet none. Existing NPCs keep every bit but 16 (and 16 only changes when the trainer list changes between trainer and not).
- Model shapes (zod, `src/core/entities/model.ts`): `trainerSpell = { spell: int.min(0) (0 = not picked yet), cost: int.min(0), reqLevel: int.min(0).max(255), reqSkill: int.min(0), reqSkillRank: int.min(0), reqSpells: array(int.positive()).max(3) }`; `trainer = { trainerId: int, type: enum('class','mount','profession','pet'), requirement: int.min(0), greeting: string, spells: array(trainerSpell) }`; `CustomNpc.trainer: trainer.nullable().default(null)`.
- `trainerId` is allocated once (above the database's highest `trainer.Id` and every project trainer id) and pinned; an existing NPC keeps the id it reads.
- Opening an existing NPC changes nothing; trainer statements are written only when the trainer differs by value from what was read (rows compared by field, never by JSON key order).
- A shared trainer (other NPCs use the same `TrainerId`) is locked (`EntityLock` `'trainer'`) and never written. **Give it its own copy** allocates a new `trainerId` and removes `'trainer'` from `origin.locked`; the trainer it was read from is never deleted or rewritten.
- `npc_trainer` (the fork's older table) is shown as a count and never written.
- A project whose `origin.original` has no `creature_default_trainer` key (saved before this change, or a fork without the trainer tables) has its trainer left alone.
- Out of scope: `trainer_locale`, editing `npc_trainer`, sharing a new trainer between NPCs, authoring spells.
- Commit messages: conventional style, no attribution lines. Run `npm test` and `npm run typecheck` before each commit that touches shared types; both must pass.
- Source edits via the Edit tool; avoid shell heredocs for TypeScript containing quotes.

## Review Focus

1. Opening an existing trainer and saving without touching the tab writes nothing and leaves `npcflag` exactly as it was (Task 2).
2. Editing a trainer that other NPCs share writes nothing; the copy path writes only new rows for a new id and leaves the shared rows alone (Task 2).
3. An NPC that stops being a trainer loses only its `creature_default_trainer` row and bit 16; the trainer rows stay (Task 2).
4. A new class trainer with no class is an error, since no player could use it (Task 4).
5. A project saved before trainers, or a fork without the trainer tables, never has trainer rows deleted or written (Tasks 1, 2 and 7).
6. A re-export of a new NPC whose spell was removed deletes the previously exported rows (Task 3).
7. The right-click menu shows "Edit trainer spells…" for an unopened database NPC whose `npcflag` has bit 16 (Task 8).
8. The real database reads cleanly: a class trainer, a shared one, a profession trainer and an NPC with `npc_trainer` includes (Task 9).

---

### Task 1: Model, reading an existing NPC's trainer, the shared count

**Files:**
- Modify: `src/core/entities/model.ts` (`trainerSpellSchema`, `trainerSchema`, `TRAINER_TYPES`, `TRAINER_TYPE_VALUE`, `trainer` on `npcFields`, `newNpc`, `EntityLock` + the origin schema's `locked` enum + `sharedTrainer` on the existing origin, `trainerUnread`, `sameTrainer`)
- Modify: `src/core/entities/from-rows.ts` (`ExistingCounts.sharedTrainer`, `npcFromRows`)
- Modify: `src/core/entities/existing.ts` (`readOriginalRows` npc branch)
- Modify: `src/main/entities/existing.ts` (`readExistingRows` returns `sharedTrainer`), `src/main/api/entities-api.ts` (passes it into the counts)
- Test: `tests/core/entities-trainer-read.test.ts` (create), extend `tests/main/api-existing.test.ts`

**Interfaces:**
- Produces: `TRAINER_TYPES = ['class','mount','profession','pet'] as const`; `TRAINER_TYPE_VALUE = { class: 0, mount: 1, profession: 2, pet: 3 }`; `type TrainerSpell`, `type Trainer` (inferred); `trainerSpellSchema`, `trainerSchema`; `CustomNpc.trainer: Trainer | null`; `newNpc(entry).trainer === null`.
- Produces: `trainerUnread(npc: { origin: StoredOrigin }): boolean` — true for an existing NPC whose `origin.original` has no own key `creature_default_trainer`; `sameTrainer(a: Trainer | null, b: Trainer | null): boolean` — field-by-field equality including the spells in order (spell arrays compared in order, `reqSpells` in order).
- Produces: existing origin gains `sharedTrainer: z.number().int().min(0).default(0)`; `ExistingCounts` gains `sharedTrainer: number` (callers that build counts for items/objects pass 0); `EntityLock` gains `'trainer'`; `origin.locked` enum gains `'trainer'`.
- Produces: `readOriginalRows(db, 'npc', entry)` includes `creature_default_trainer`, `trainer`, `trainer_spell` and `npc_trainer` (the NPC's own rows by `ID`) — each key present only when the table exists (use `db.columns`, as `npc_vendor` does); `trainer` and `trainer_spell` rows are those of the NPC's `TrainerId` (empty arrays when it has none).
- Produces: `npcFromRows(entry, rows, counts)` fills `trainer` when `rows.creature_default_trainer?.[0]` and a `trainer` row for its `TrainerId` exist (`type` from `Type` by `TRAINER_TYPE_VALUE`; a `Type` outside 0..3 is handled as the Behavior paragraph says), and adds `'trainer'` to `locked` when `counts.sharedTrainer > 0`.
- Produces (main): `readExistingRows(...)` result gains `sharedTrainer` = the number of OTHER `creature_default_trainer` rows with the same `TrainerId`.

Behavior: `type` mapping uses `Type` 0..3; any other value reads as the nearest safe thing — keep the raw type unrepresentable by locking: when `Type` is not 0..3, set `trainer: null` and add `'trainer'` to `locked` (the editor does not model it, so it is left alone). Spell rows map `SpellId`→`spell`, `MoneyCost`→`cost`, `ReqLevel`→`reqLevel`, `ReqSkillLine`→`reqSkill`, `ReqSkillRank`→`reqSkillRank`, and `ReqAbility1..3` that are above 0, in order, →`reqSpells`; spells ordered by `SpellId` ascending. A `creature_default_trainer` row whose `trainer` row is missing reads as `trainer: null` and locks `'trainer'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-trainer-read.test.ts
import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { readOriginalRows } from '../../src/core/entities/existing';
import { newNpc, projectEntitiesSchema, readProjectEntities, sameTrainer, trainerUnread } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { forkDb } from '../helpers/fixtures';

const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const template = { entry: '198', name: 'Warrior Trainer', subname: '', minlevel: '30', maxlevel: '30', faction: '11', rank: '0', type: '7', npcflag: '51', lootid: '0', AIName: '', ScriptName: '' };
const trainer = { Id: '17', Type: '0', Requirement: '1', Greeting: 'Hello, warrior!', VerifiedBuild: '12340' };
const spell = (id: string, extra: Record<string, string> = {}) => ({ TrainerId: '17', SpellId: id, MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10', VerifiedBuild: '12340', ...extra });
const rows = { creature_template: [template], creature_default_trainer: [{ CreatureId: '198', TrainerId: '17' }], trainer: [trainer], trainer_spell: [spell('78'), spell('100', { ReqLevel: '4', ReqAbility1: '78', ReqAbility2: '5', ReqSkillLine: '26', ReqSkillRank: '50', MoneyCost: '3500' })] };

describe('reading an existing NPC\'s trainer', () => {
  it('maps the trainer, its type and class, and its spells in spell order', () => {
    const npc = npcFromRows(198, { ...rows, trainer_spell: [rows.trainer_spell[1]!, rows.trainer_spell[0]!] }, counts);
    expect(npc.trainer).toEqual({
      trainerId: 17, type: 'class', requirement: 1, greeting: 'Hello, warrior!',
      spells: [
        { spell: 78, cost: 100, reqLevel: 10, reqSkill: 0, reqSkillRank: 0, reqSpells: [] },
        { spell: 100, cost: 3500, reqLevel: 4, reqSkill: 26, reqSkillRank: 50, reqSpells: [78, 5] },
      ],
    });
    expect(npc.origin).toMatchObject({ kind: 'existing', locked: [] });
  });

  it('reads the other types and an NPC without a trainer', () => {
    const profession = { ...rows, trainer: [{ ...trainer, Type: '2', Requirement: '0' }] };
    expect(npcFromRows(198, profession, counts).trainer).toMatchObject({ type: 'profession', requirement: 0 });
    expect(npcFromRows(198, { ...rows, trainer: [{ ...trainer, Type: '1' }] }, counts).trainer).toMatchObject({ type: 'mount' });
    expect(npcFromRows(198, { ...rows, trainer: [{ ...trainer, Type: '3' }] }, counts).trainer).toMatchObject({ type: 'pet' });
    expect(npcFromRows(198, { creature_template: [template], creature_default_trainer: [] }, counts).trainer).toBeNull();
    expect(npcFromRows(198, { creature_template: [template] }, counts).trainer).toBeNull();
  });

  it('locks a trainer other NPCs share', () => {
    expect(npcFromRows(198, rows, { ...counts, sharedTrainer: 30 }).origin).toMatchObject({ locked: ['trainer'], sharedTrainer: 30 });
  });

  it('locks, and does not model, a trainer type it does not know or one whose row is missing', () => {
    const odd = npcFromRows(198, { ...rows, trainer: [{ ...trainer, Type: '9' }] }, counts);
    expect(odd.trainer).toBeNull();
    expect(odd.origin).toMatchObject({ locked: ['trainer'] });
    const gone = npcFromRows(198, { ...rows, trainer: [] }, counts);
    expect(gone.trainer).toBeNull();
    expect(gone.origin).toMatchObject({ locked: ['trainer'] });
  });

  it('a new NPC and one saved before trainers have none', () => {
    expect(newNpc(1).trainer).toBeNull();
    const { trainer: _t, ...old } = newNpc(7);
    expect(readProjectEntities({ npcs: [old], objects: [], items: [] }).npcs[0]!.trainer).toBeNull();
    const bad = { ...newNpc(7), trainer: { trainerId: 1, type: 'class', requirement: 1, greeting: '', spells: [{ spell: 1, cost: -5, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] }] } };
    expect(projectEntitiesSchema.safeParse({ npcs: [bad], objects: [], items: [] }).success).toBe(false);
    const tooMany = { ...bad, trainer: { ...bad.trainer, spells: [{ spell: 1, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [1, 2, 3, 4] }] } };
    expect(projectEntitiesSchema.safeParse({ npcs: [tooMany], objects: [], items: [] }).success).toBe(false);
  });

  it('knows stock never read from stock that was', () => {
    expect(trainerUnread(npcFromRows(198, rows, counts))).toBe(false);
    const { creature_default_trainer: _k, ...unread } = rows;
    expect(trainerUnread(npcFromRows(198, unread, counts))).toBe(true);
    expect(trainerUnread(newNpc(1))).toBe(false);
  });

  it('compares trainers by value, in order', () => {
    const a = npcFromRows(198, rows, counts).trainer;
    const b = npcFromRows(198, rows, counts).trainer;
    expect(sameTrainer(a, b)).toBe(true);
    expect(sameTrainer(a, null)).toBe(false);
    expect(sameTrainer(null, null)).toBe(true);
    expect(sameTrainer(a, { ...b!, greeting: 'Hi' })).toBe(false);
    expect(sameTrainer(a, { ...b!, spells: [...b!.spells].reverse() })).toBe(false);
    const shuffledKeys = { requirement: b!.requirement, spells: b!.spells.map((s) => ({ reqSpells: s.reqSpells, reqSkillRank: s.reqSkillRank, reqSkill: s.reqSkill, reqLevel: s.reqLevel, cost: s.cost, spell: s.spell })), greeting: b!.greeting, type: b!.type, trainerId: b!.trainerId };
    expect(sameTrainer(a, shuffledKeys)).toBe(true);
  });
});

describe('the rows an existing NPC\'s trainer is read from', () => {
  const insertAll = (db: FakeWorldDb) => {
    db.insert('creature_template', template);
    db.insert('creature_default_trainer', { CreatureId: '198', TrainerId: '17' });
    db.insert('creature_default_trainer', { CreatureId: '328', TrainerId: '16' });
    db.insert('trainer', trainer);
    db.insert('trainer', { ...trainer, Id: '16' });
    db.insert('trainer_spell', spell('78'));
    db.insert('trainer_spell', { ...spell('78'), TrainerId: '16' });
    db.insert('npc_trainer', { ID: '198', SpellID: '-200007', MoneyCost: '0', ReqSkillLine: '0', ReqSkillRank: '0', ReqLevel: '0', ReqSpell: '0' });
  };

  it('reads the default trainer, its row, its spells and the NPC\'s npc_trainer rows', async () => {
    const db = forkDb();
    insertAll(db);
    const read = await readOriginalRows(db, 'npc', 198);
    expect(read!.creature_default_trainer).toEqual([{ CreatureId: '198', TrainerId: '17' }]);
    expect(read!.trainer).toEqual([trainer]);
    expect(read!.trainer_spell).toEqual([spell('78')]);
    expect(read!.npc_trainer).toHaveLength(1);
  });

  it('reads empty lists for an NPC that is not a trainer', async () => {
    const db = forkDb();
    insertAll(db);
    db.insert('creature_template', { ...template, entry: '999' });
    const read = await readOriginalRows(db, 'npc', 999);
    expect(read).toMatchObject({ creature_default_trainer: [], trainer: [], trainer_spell: [] });
  });

  it('leaves the keys out when the fork has no trainer tables, so the trainer is never written', async () => {
    const db = FakeWorldDb.fromFork(['creature_template', 'creature_template_model', 'creature_equip_template', 'creature_loot_template', 'creature', 'game_event_creature', 'npc_vendor']);
    db.insert('creature_template', template);
    const read = await readOriginalRows(db, 'npc', 198);
    for (const key of ['creature_default_trainer', 'trainer', 'trainer_spell']) expect(read).not.toHaveProperty(key);
  });
});
```

Add to `tests/main/api-existing.test.ts` (it builds a fake world DB in `setup()`): insert `creature_default_trainer` rows `{ CreatureId: '1423', TrainerId: '5' }` and `{ CreatureId: '68', TrainerId: '5' }`, a `trainer` row `{ Id: '5', Type: '0', Requirement: '1', Greeting: 'Hi', VerifiedBuild: '0' }` and one `trainer_spell`; then `readExistingEntity('npc', 1423)` must have `origin.sharedTrainer === 1`, `origin.locked` containing `'trainer'` and `trainer.spells.length === 1`; for an NPC with a trainer used only by itself, `sharedTrainer === 0` and no lock.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/entities-trainer-read.test.ts tests/main/api-existing.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block and Behavior paragraph. Everywhere `ExistingCounts` is built for items and objects, pass `sharedTrainer: 0`; `itemFromRows`/`objectFromRows` ignore it. `origin()` in `from-rows.ts` stores `sharedTrainer` on the existing origin.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core tests/main && npm run typecheck` — Expected: PASS. Update any older test that does `toEqual` on a whole NPC or origin to include `trainer: null` / `sharedTrainer: 0`.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): NPCs carry a trainer read from the trainer tables"
```

---

### Task 2: Writing an existing NPC's trainer

**Files:**
- Modify: `src/core/entities/existing.ts` (`npcStatements`, `trainerRows` helpers, bit constants)
- Test: `tests/core/entities-trainer-existing.test.ts` (create)

**Interfaces:**
- Consumes: `CustomNpc.trainer`, `Trainer`, `sameTrainer`, `trainerUnread`, `TRAINER_TYPE_VALUE` (Task 1); `writeTable`, `keepUnedited`, `rowsOf` (existing).
- Produces: `existingStatements(...)` writes, for an existing NPC whose trainer changed (not unread, not locked): `creature_default_trainer` (key `{ CreatureId }`), `trainer` (key `{ Id }` of the NEW trainer id) and `trainer_spell` (key `{ TrainerId }` of the new id); and `npcflag` bit 16.

Behavior:
- `asRead = npcFromRows(...)` (already computed). Changed = `!trainerUnread(npc) && !origin.locked.includes('trainer') && !sameTrainer(npc.trainer, asRead.trainer)`. An unchanged, unread or locked trainer writes nothing and leaves bit 16 as the original row has it.
- Flags when changed: `npcflag = (original & ~(GOSSIP|QUEST_GIVER|VENDOR|TRAINER)) | …existing bits… | vendorBit | trainerBit`, with `TRAINER_BIT = 16` and `trainerBit = trainer ? 16 : 0` when changed, else `original & 16`. The sub-type bits (32, 64) are never added or cleared for an existing NPC.
- Rows when `npc.trainer` is not null: `creature_default_trainer`: delete `{ CreatureId: entry }`, insert `{ CreatureId, TrainerId }` (original row's other columns carried). `trainer` and `trainer_spell`: key by the new id. When `npc.trainer.trainerId` equals the id that was read, delete that id's rows and insert the current ones, each carrying the original row of the same key for unmodelled columns (`VerifiedBuild`; spells matched by `SpellId`); the trainer row is the original row with `Type`, `Requirement`, `Greeting` laid over it. When the id differs (an own copy), the keys are the new id, nothing is carried, and the original trainer's rows are not in any key so they are neither deleted nor reverted. `Requirement` is written as the class for type `class` and `'0'` otherwise.
- Spell row: `{ ...carried, TrainerId, SpellId, MoneyCost, ReqSkillLine: reqSkill, ReqSkillRank: reqSkillRank, ReqAbility1..3: reqSpells[0..2] or '0', ReqLevel }`, ordered by spell id ascending.
- When `npc.trainer` is null and the read one was not (no longer a trainer): only `creature_default_trainer` for `{ CreatureId }` is deleted (revert re-inserts the original row); the trainer rows are left; bit 16 is cleared.
- The writeTable revert machinery already restores originals for the keys written.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-trainer-existing.test.ts
import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, type CustomNpc } from '../../src/core/entities/model';

const template = { entry: '198', name: 'Warrior Trainer', subname: '', minlevel: '30', maxlevel: '30', faction: '11', rank: '0', type: '7', npcflag: '51', lootid: '0', AIName: '', ScriptName: '' };
const model = { CreatureID: '198', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const trainerRow = { Id: '17', Type: '0', Requirement: '1', Greeting: 'Hello, warrior!', VerifiedBuild: '12340' };
const spell = (id: string, extra: Record<string, string> = {}) => ({ TrainerId: '17', SpellId: id, MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10', VerifiedBuild: '12340', ...extra });
const defaultRow = { CreatureId: '198', TrainerId: '17' };
const trained = { creature_template: [template], creature_template_model: [model], creature_default_trainer: [defaultRow], trainer: [trainerRow], trainer_spell: [spell('78'), spell('100')] };
const untrained = { creature_template: [{ ...template, npcflag: '3' }], creature_template_model: [model], creature_default_trainer: [], trainer: [], trainer_spell: [] };
const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const store = (npc: CustomNpc) => ({ ...EMPTY_ENTITIES, npcs: [npc] });
const TABLES = ['creature_default_trainer', 'trainer', 'trainer_spell'];
const trainerStatements = (npc: CustomNpc) => {
  const out = existingStatements(store(npc), []);
  const only = (list: typeof out.apply) => list.filter((s) => TABLES.includes(s.table));
  return { apply: only(out.apply), revert: only(out.revert) };
};
const flagOf = (npc: CustomNpc) => {
  const insert = existingStatements(store(npc), []).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> };
  return Number(insert.row.npcflag);
};

describe('writing an existing NPC\'s trainer', () => {
  it('writes nothing for a trainer it only read, and leaves npcflag as it was', () => {
    const npc = npcFromRows(198, trained, counts);
    expect(trainerStatements(npc)).toEqual({ apply: [], revert: [] });
    expect(flagOf(npc)).toBe(51);
  });

  it('replaces its own trainer\'s spells by key, carrying VerifiedBuild, and the revert puts the originals back', () => {
    const npc = npcFromRows(198, trained, counts);
    const edited = { ...npc, trainer: { ...npc.trainer!, greeting: 'Welcome!', spells: [{ ...npc.trainer!.spells[0]!, cost: 250 }, { spell: 5, cost: 1, reqLevel: 2, reqSkill: 0, reqSkillRank: 0, reqSpells: [78] }] } };
    const { apply, revert } = trainerStatements(edited);
    const added = { TrainerId: '17', SpellId: '5', MoneyCost: '1', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '78', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '2' };
    expect(apply).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'insert', table: 'creature_default_trainer', row: defaultRow },
      { kind: 'delete', table: 'trainer', key: { Id: '17' } },
      { kind: 'insert', table: 'trainer', row: { ...trainerRow, Greeting: 'Welcome!' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '17' } },
      { kind: 'insert', table: 'trainer_spell', row: added },
      { kind: 'insert', table: 'trainer_spell', row: spell('78', { MoneyCost: '250' }) },
    ]);
    expect(revert).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'insert', table: 'creature_default_trainer', row: defaultRow },
      { kind: 'delete', table: 'trainer', key: { Id: '17' } },
      { kind: 'insert', table: 'trainer', row: trainerRow },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '17' } },
      { kind: 'insert', table: 'trainer_spell', row: spell('78') },
      { kind: 'insert', table: 'trainer_spell', row: spell('100') },
    ]);
    expect(flagOf(edited)).toBe(51);
  });

  it('writes the class only for a class trainer and 0 for the other types', () => {
    const npc = npcFromRows(198, trained, counts);
    const asProfession = trainerStatements({ ...npc, trainer: { ...npc.trainer!, type: 'profession', requirement: 7 } }).apply;
    expect(asProfession.find((s) => s.table === 'trainer' && s.kind === 'insert')).toMatchObject({ row: { Type: '2', Requirement: '0' } });
    const reclassed = trainerStatements({ ...npc, trainer: { ...npc.trainer!, requirement: 2 } }).apply;
    expect(reclassed.find((s) => s.table === 'trainer' && s.kind === 'insert')).toMatchObject({ row: { Type: '0', Requirement: '2' } });
  });

  it('makes an NPC a trainer: a new trainer row under its own id, and bit 16 set, other bits kept', () => {
    const npc = npcFromRows(198, untrained, counts);
    const made = { ...npc, trainer: { trainerId: 900033, type: 'class' as const, requirement: 1, greeting: 'Hi', spells: [{ spell: 78, cost: 100, reqLevel: 10, reqSkill: 0, reqSkillRank: 0, reqSpells: [] }] } };
    const { apply, revert } = trainerStatements(made);
    expect(apply).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'insert', table: 'creature_default_trainer', row: { CreatureId: '198', TrainerId: '900033' } },
      { kind: 'delete', table: 'trainer', key: { Id: '900033' } },
      { kind: 'insert', table: 'trainer', row: { Id: '900033', Type: '0', Requirement: '1', Greeting: 'Hi' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '900033' } },
      { kind: 'insert', table: 'trainer_spell', row: { TrainerId: '900033', SpellId: '78', MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10' } },
    ]);
    expect(revert).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'delete', table: 'trainer', key: { Id: '900033' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '900033' } },
    ]);
    expect(flagOf(made)).toBe(3 | 16);
  });

  it('stops being a trainer by deleting only the default-trainer row and clearing bit 16', () => {
    const npc = npcFromRows(198, trained, counts);
    const { apply, revert } = trainerStatements({ ...npc, trainer: null });
    expect(apply).toEqual([{ kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } }]);
    expect(revert).toEqual([{ kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } }, { kind: 'insert', table: 'creature_default_trainer', row: defaultRow }]);
    expect(flagOf({ ...npc, trainer: null })).toBe(51 & ~16);
  });

  it('treats a trainer added and taken away again as unchanged', () => {
    const npc = npcFromRows(198, untrained, counts);
    expect(trainerStatements({ ...npc, trainer: null })).toEqual({ apply: [], revert: [] });
    expect(flagOf({ ...npc, trainer: null })).toBe(3);
  });

  it('never writes a trainer other NPCs share', () => {
    const npc = npcFromRows(198, trained, { ...counts, sharedTrainer: 30 });
    const edited = { ...npc, trainer: { ...npc.trainer!, greeting: 'Changed' } };
    expect(trainerStatements(edited)).toEqual({ apply: [], revert: [] });
    expect(flagOf(edited)).toBe(51);
  });

  it('after its own copy, writes new rows under the new id and leaves the shared trainer\'s rows alone', () => {
    const shared = npcFromRows(198, trained, { ...counts, sharedTrainer: 30 });
    const copied: CustomNpc = {
      ...shared,
      trainer: { ...shared.trainer!, trainerId: 900033 },
      origin: { ...shared.origin, locked: [] } as CustomNpc['origin'],
    };
    const { apply, revert } = trainerStatements(copied);
    expect(apply.filter((s) => s.kind === 'delete')).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'delete', table: 'trainer', key: { Id: '900033' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '900033' } },
    ]);
    expect(apply.find((s) => s.table === 'creature_default_trainer' && s.kind === 'insert')).toMatchObject({ row: { CreatureId: '198', TrainerId: '900033' } });
    expect(apply.filter((s) => s.table === 'trainer_spell' && s.kind === 'insert')).toHaveLength(2);
    // The shared trainer 17 is in no key of either list
    for (const s of [...apply, ...revert]) {
      if (s.table === 'trainer' && s.kind === 'insert') expect(s.row.Id).not.toBe('17');
      if (s.table === 'trainer_spell' && s.kind === 'insert') expect(s.row.TrainerId).not.toBe('17');
    }
    // The revert puts the NPC back on trainer 17
    expect(revert).toContainEqual({ kind: 'insert', table: 'creature_default_trainer', row: defaultRow });
  });

  it('never touches a trainer it did not read (a project saved before trainers, or a fork without the tables)', () => {
    const { creature_default_trainer: _a, trainer: _b, trainer_spell: _c, ...unread } = trained;
    const npc = npcFromRows(198, unread, counts);
    const edited = { ...npc, trainer: { trainerId: 900033, type: 'class' as const, requirement: 1, greeting: 'Hi', spells: [] } };
    expect(trainerStatements(edited)).toEqual({ apply: [], revert: [] });
    expect(flagOf(edited)).toBe(51);
  });

  it('leaves an NPC with a trainer it could not model alone', () => {
    const odd = npcFromRows(198, { ...trained, trainer: [{ ...trainerRow, Type: '9' }] }, counts);
    expect(trainerStatements({ ...odd, trainer: { trainerId: 900033, type: 'class' as const, requirement: 1, greeting: '', spells: [] } })).toEqual({ apply: [], revert: [] });
  });
});
```


- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/entities-trainer-existing.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the behavior above in `npcStatements`, keeping `npcflag` in the derived list passed to `keepUnedited`.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core/entities-trainer-existing.test.ts tests/core/entities-existing.test.ts tests/core/entities-vendor-existing.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): export an existing NPC's edited trainer"
```

---

### Task 3: Compiling a new NPC's trainer

**Files:**
- Modify: `src/core/entities/compile.ts`, `src/core/entities/context.ts` (`ENTITY_TABLES`, `ENTITY_KEYS`), `src/core/scripts/statements.ts` (`DELETE_ORDER`, `INSERT_ORDER`), `src/main/api/export-api.ts` (the `entityBefore` list)
- Test: `tests/core/entities-trainer-compile.test.ts` (create)

**Interfaces:**
- Consumes: `CustomNpc.trainer` (Task 1).
- Produces: `compileEntities(...)` output: `inserts.creature_default_trainer` `{ CreatureId, TrainerId }`, `inserts.trainer` `{ Id, Type, Requirement, Greeting }`, `inserts.trainer_spell` rows (as in Task 2, no `VerifiedBuild`), for each new NPC with a trainer; `deletes` for every new NPC: `creature_default_trainer` by `{ CreatureId }` for every new NPC entry, and for every trainer id a new NPC holds (and every trainer id previously exported by it, found through `context.trainerIds`, see below): `trainer` by `{ Id }` and `trainer_spell` by `{ TrainerId }`; `creature_template.npcflag` includes bit 16 and the sub-type bit when the NPC has a trainer.
- Produces: `EntityContext.trainerIds: RawRow[]` — the `creature_default_trainer` rows `{ CreatureId, TrainerId }` the database holds now for the new NPCs' entries (read in `readEntityContext`), so a trainer id the NPC pointed at on an earlier export is deleted when it no longer has one (`EMPTY_ENTITY_CONTEXT.trainerIds = []`).

Behavior: all rows as strings; `Type` from `TRAINER_TYPE_VALUE`, `Requirement` = class for type class else `'0'`, spells ordered by spell id ascending, `ReqAbility1..3` from `reqSpells` or `'0'`. `npcflag` = existing bits | `16` | (class `32` | mount/profession `64`). Delete only trainer ids that are not also held by another NPC's trainer in this store, and never an id the database gives to an NPC outside this project's new NPCs (`trainerIds` rows whose `CreatureId` is a new NPC entry only). Order: deletes before inserts; `creature_default_trainer` and `trainer_spell` deleted before `trainer`; `trainer` inserted before `trainer_spell` and `creature_default_trainer`, all after `creature_template`. `ENTITY_KEYS`: `creature_default_trainer: ['CreatureId']`, `trainer: ['Id']`, `trainer_spell: ['TrainerId','SpellId']`. `export-api.ts` compares `['creature_default_trainer','CreatureId']`, `['trainer','Id']`, `['trainer_spell','TrainerId']` against the database.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-trainer-compile.test.ts
import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { ENTITY_KEYS, ENTITY_TABLES, EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import { loadSchema } from '../../src/core/schema/load';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';

const trainer = (over: Partial<NonNullable<CustomNpc['trainer']>> = {}) => ({
  trainerId: 900033, type: 'class' as const, requirement: 1, greeting: 'Hello!',
  spells: [
    { spell: 100, cost: 3500, reqLevel: 4, reqSkill: 26, reqSkillRank: 50, reqSpells: [78, 5] },
    { spell: 78, cost: 100, reqLevel: 10, reqSkill: 0, reqSkillRank: 0, reqSpells: [] },
  ],
  ...over,
});
const teacher: CustomNpc = { ...newNpc(12000001), name: 'Hela', displayId: 1, gossip: true, spawns: [{ ...newSpawn(6000001) }], trainer: trainer() };
const plain: CustomNpc = { ...newNpc(12000002), name: 'Idle', displayId: 1 };
const compile = (npcs: CustomNpc[], context = EMPTY_ENTITY_CONTEXT) => compileEntities({ entities: { npcs, objects: [], items: [] }, givers: [], context });

describe('compiling a new NPC\'s trainer', () => {
  it('writes the default-trainer row, the trainer and its spells in spell order', () => {
    const out = compile([teacher]);
    expect(out.inserts.creature_default_trainer).toEqual([{ CreatureId: '12000001', TrainerId: '900033' }]);
    expect(out.inserts.trainer).toEqual([{ Id: '900033', Type: '0', Requirement: '1', Greeting: 'Hello!' }]);
    expect(out.inserts.trainer_spell).toEqual([
      { TrainerId: '900033', SpellId: '78', MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10' },
      { TrainerId: '900033', SpellId: '100', MoneyCost: '3500', ReqSkillLine: '26', ReqSkillRank: '50', ReqAbility1: '78', ReqAbility2: '5', ReqAbility3: '0', ReqLevel: '4' },
    ]);
  });

  it('writes 0 as the requirement of the other types', () => {
    expect(compile([{ ...teacher, trainer: trainer({ type: 'profession', requirement: 7 }) }]).inserts.trainer![0]).toMatchObject({ Type: '2', Requirement: '0' });
    expect(compile([{ ...teacher, trainer: trainer({ type: 'mount' }) }]).inserts.trainer![0]).toMatchObject({ Type: '1', Requirement: '0' });
    expect(compile([{ ...teacher, trainer: trainer({ type: 'pet' }) }]).inserts.trainer![0]).toMatchObject({ Type: '3', Requirement: '0' });
  });

  it('sets the trainer bit and the type\'s sub-type bit with the gossip bit, and nothing for a non-trainer', () => {
    const flag = (t: ReturnType<typeof trainer> | null) => compile([{ ...teacher, trainer: t }]).inserts.creature_template![0]!.npcflag;
    expect(flag(trainer())).toBe(String(1 | 16 | 32));
    expect(flag(trainer({ type: 'profession' }))).toBe(String(1 | 16 | 64));
    expect(flag(trainer({ type: 'mount' }))).toBe(String(1 | 16 | 64));
    expect(flag(trainer({ type: 'pet' }))).toBe(String(1 | 16));
    expect(flag(null)).toBe('1');
  });

  it('deletes every new NPC\'s default-trainer row and each trainer it holds, so a removed spell or trainer is cleaned on re-export', () => {
    const out = compile([teacher, plain]);
    expect(out.deletes.creature_default_trainer).toEqual([{ CreatureId: '12000001' }, { CreatureId: '12000002' }]);
    expect(out.deletes.trainer).toEqual([{ Id: '900033' }]);
    expect(out.deletes.trainer_spell).toEqual([{ TrainerId: '900033' }]);
  });

  it('also deletes a trainer the database has it pointing at from an earlier export', () => {
    const context = { ...EMPTY_ENTITY_CONTEXT, trainerIds: [{ CreatureId: '12000001', TrainerId: '900031' }, { CreatureId: '555', TrainerId: '17' }] };
    const out = compile([{ ...teacher, trainer: null }], context);
    expect(out.deletes.trainer).toEqual([{ Id: '900031' }]);
    expect(out.deletes.trainer_spell).toEqual([{ TrainerId: '900031' }]);
  });

  it('is a table the entities are written to, keyed correctly', () => {
    for (const table of ['creature_default_trainer', 'trainer', 'trainer_spell']) expect(ENTITY_TABLES).toContain(table);
    expect(ENTITY_KEYS.creature_default_trainer).toEqual(['CreatureId']);
    expect(ENTITY_KEYS.trainer).toEqual(['Id']);
    expect(ENTITY_KEYS.trainer_spell).toEqual(['TrainerId', 'SpellId']);
  });

  it('orders the statements: spells and the default row deleted before the trainer, all inserted after the template', async () => {
    const tables = ['creature_template', 'creature_template_model', 'creature_default_trainer', 'trainer', 'trainer_spell'];
    const schema = await loadSchema(FakeWorldDb.fromFork(tables), tables);
    const { statements } = scriptStatements(compile([teacher]), schema);
    const at = (kind: string, table: string) => statements.findIndex((s) => s.kind === kind && s.table === table);
    expect(at('delete', 'trainer_spell')).toBeLessThan(at('delete', 'trainer'));
    expect(at('delete', 'creature_default_trainer')).toBeLessThan(at('delete', 'creature_template'));
    expect(at('delete', 'trainer')).toBeLessThan(at('delete', 'creature_template'));
    expect(at('insert', 'creature_template')).toBeLessThan(at('insert', 'trainer'));
    expect(at('insert', 'trainer')).toBeLessThan(at('insert', 'trainer_spell'));
    expect(at('insert', 'trainer')).toBeLessThan(at('insert', 'creature_default_trainer'));
  });
});
```

Also extend `tests/core/entities-statements.test.ts` pattern if an existing test enumerates every `deletes` key (update its expectation to include the new tables).

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/entities-trainer-compile.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces/Behavior. `readEntityContext` reads `creature_default_trainer` with `rowsOrNone(db, 'creature_default_trainer', { CreatureId: npcEntries })` and keeps `CreatureId`, `TrainerId`.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core tests/main` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): compile a new NPC's trainer"
```

---

### Task 4: Validation

**Files:**
- Modify: `src/core/entities/validate.ts`, `src/main/api/checks.ts`
- Test: `tests/core/entities-trainer-validate.test.ts` (create), extend `tests/main/api-authoring.test.ts`

**Interfaces:**
- Consumes: `CustomNpc.trainer`, `trainerUnread`, existing `knownSpell` input.
- Produces: `entityIssues` input gains `trainerIdTaken?: ((id: number) => boolean) | null` (true when the database already has that `trainer.Id` and this project did not read it; null skips). New codes (all with `fieldId: ENTITIES_FIELD`, message prefixed by the entity label):
  - errors: `TRAINER_NO_ID` (`trainerId <= 0`: "it has no trainer id; allocate one with allocate_ids kind trainer."), `TRAINER_NO_SPELL` ("a spell row has no spell."), `TRAINER_DUPLICATE` ("spell N is listed twice; the database allows each spell once." once per spell), `TRAINER_REQ_SPELL` ("spell N needs itself first."), `TRAINER_NO_CLASS` ("it is a class trainer with no class chosen, so no player could use it.");
  - warnings: `TRAINER_EMPTY` ("it teaches nothing."), `TRAINER_UNKNOWN_SPELL` ("spell N is not in the server's spell list." only when `knownSpell` is given, once per spell), `TRAINER_NOT_READ` (trainer set but `trainerUnread(entity)`: "its trainer was never read from the database, so this trainer is not written; put the NPC back as the database has it and edit it again."), `TRAINER_ID_TAKEN` ("trainer id N is already a trainer in the database.").
- A locked (shared) existing trainer is not checked beyond `TRAINER_NOT_READ`: it is not written.

Behavior: checks run only for NPCs (`'trainer' in entity && entity.trainer`), skipped entirely when `trainerUnread` (only `TRAINER_NOT_READ` reported) or when `origin.locked` contains `'trainer'` and the trainer id equals the one read (no check needed). `TRAINER_ID_TAKEN` is checked only for a trainer that is new to the project: new NPCs, or an own copy whose id differs from the id read (`origin.original.creature_default_trainer[0].TrainerId`). In `checks.ts` collect those ids, read `trainer` rows with `rowsOrNone`, and pass `trainerIdTaken`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-trainer-validate.test.ts
import { describe, expect, it } from 'vitest';
import { entityIssues } from '../../src/core/entities/validate';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';

type T = NonNullable<CustomNpc['trainer']>;
const spell = (id: number, over: Partial<T['spells'][number]> = {}) => ({ spell: id, cost: 10, reqLevel: 1, reqSkill: 0, reqSkillRank: 0, reqSpells: [], ...over });
const trainer = (over: Partial<T> = {}): T => ({ trainerId: 900033, type: 'class', requirement: 1, greeting: 'Hi', spells: [spell(78)], ...over });
const npc = (t: T | null, base: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(1), x: 1 }], trainer: t, ...base });
const check = (n: CustomNpc, over: Partial<Parameters<typeof entityIssues>[0]> = {}) => entityIssues({ entities: { npcs: [n], objects: [], items: [] }, dbNames: new Map(), ...over });
const codes = (list: ReturnType<typeof check>) => list.map((i) => `${i.severity}:${i.code}`);

describe('trainer checks', () => {
  it('accepts a clean trainer', () => {
    expect(check(npc(trainer()), { knownSpell: () => true, trainerIdTaken: () => false })).toEqual([]);
    expect(check(npc(null))).toEqual([]);
  });
  it('errors on no id, an unpicked spell, a repeated spell and a spell that needs itself', () => {
    expect(codes(check(npc(trainer({ trainerId: 0 }))))).toEqual(['error:TRAINER_NO_ID']);
    expect(codes(check(npc(trainer({ spells: [spell(0)] }))))).toEqual(['error:TRAINER_NO_SPELL']);
    expect(codes(check(npc(trainer({ spells: [spell(5), spell(6), spell(5), spell(5)] }))))).toEqual(['error:TRAINER_DUPLICATE']);
    expect(codes(check(npc(trainer({ spells: [spell(5, { reqSpells: [5] })] }))))).toEqual(['error:TRAINER_REQ_SPELL']);
  });
  it('errors on a class trainer with no class, since no player could use it, but not on other types', () => {
    expect(codes(check(npc(trainer({ requirement: 0 }))))).toEqual(['error:TRAINER_NO_CLASS']);
    expect(check(npc(trainer({ type: 'profession', requirement: 0 })))).toEqual([]);
  });
  it('warns about an empty trainer', () => {
    expect(codes(check(npc(trainer({ spells: [] }))))).toEqual(['warning:TRAINER_EMPTY']);
  });
  it('warns about a spell the server does not have, once, only when it can tell', () => {
    expect(codes(check(npc(trainer({ spells: [spell(9), spell(9)] })), { knownSpell: () => false }))).toEqual(['error:TRAINER_DUPLICATE', 'warning:TRAINER_UNKNOWN_SPELL']);
    expect(check(npc(trainer({ spells: [spell(9)] })), { knownSpell: null })).toEqual([]);
  });
  it('warns when a new trainer\'s id is already a trainer in the database', () => {
    expect(codes(check(npc(trainer()), { trainerIdTaken: (id) => id === 900033 }))).toEqual(['warning:TRAINER_ID_TAKEN']);
  });
  it('does not check the id of an existing NPC\'s own trainer, only a copy\'s new one', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '1', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    const taken = () => true;
    expect(check(npc(trainer({ trainerId: 17 }), { origin }), { trainerIdTaken: taken })).toEqual([]);
    expect(codes(check(npc(trainer({ trainerId: 900033 }), { origin }), { trainerIdTaken: taken }))).toEqual(['warning:TRAINER_ID_TAKEN']);
  });
  it('only says an unread trainer is not written', () => {
    const origin = { kind: 'existing' as const, original: { creature_template: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    expect(codes(check(npc(trainer({ spells: [spell(0)] }), { origin })))).toEqual(['warning:TRAINER_NOT_READ']);
    expect(check(npc(null, { origin }))).toEqual([]);
  });
  it('skips the checks of a locked shared trainer', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '1', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 30, locked: ['trainer' as const] };
    expect(check(npc(trainer({ trainerId: 17, spells: [spell(0)] }), { origin }))).toEqual([]);
  });
});
```

Add to `tests/main/api-authoring.test.ts`: a project NPC whose trainer id is a `trainer` row the fake DB has (`db.insert('trainer', { Id: '900033', Type: '0', Requirement: '1', Greeting: '', VerifiedBuild: '0' })`) reports `TRAINER_ID_TAKEN` through `api.projectIssues()`, and one whose id is free does not.

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** the checks and the `checks.ts` plumbing.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core/entities-trainer-validate.test.ts tests/core/entities-validate.test.ts tests/main` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): validate trainers"
```

---

### Task 5: Allocating trainer ids

**Files:**
- Modify: `src/shared/ipc/entities.ts` (`AllocKind`), `src/shared/ipc/requests.ts` (the `allocateIds` kind enum), `src/main/api/entities-api.ts` (`allocateIds`), `src/main/mcp/tools/entities.ts` (the tool's kind enum and description)
- Test: `tests/main/api-trainer-alloc.test.ts` (create), extend the MCP tool test that lists `allocate_ids` kinds (find with `grep -l allocate_ids tests/main`)

**Interfaces:**
- Produces: `allocateIds('trainer', n)`: ids above `max(trainer.Id)` in the database (via `selectMax('trainer','Id')`; a fork without the table counts as 0) and above every `trainer.trainerId` of the project's NPCs.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/api-trainer-alloc.test.ts — copy `setup()` from tests/main/api-existing.test.ts
// seed: db.insert('trainer', { Id: '900032', Type: '0', Requirement: '1', Greeting: '', VerifiedBuild: '0' });
it('allocates trainer ids above the database and the project', async () => {
  const { api } = await setup();
  expect(((await api.allocateIds('trainer', 2)) as any).value).toEqual([900033, 900034]);
  await api.putProjectEntities({ npcs: [{ ...newNpc(90001), name: 'T', displayId: 1, trainer: { trainerId: 900040, type: 'class', requirement: 1, greeting: '', spells: [] } }], objects: [], items: [] });
  expect(((await api.allocateIds('trainer', 1)) as any).value).toEqual([900041]);
});
it('accepts the kind over IPC and as an MCP tool argument', () => {
  expect(parseRequest('allocateIds', ['trainer', 1]).ok).toBe(true);
});
```

Extend the MCP tool test so the `allocate_ids` input accepts `kind: 'trainer'`.

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/main && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(main): allocate trainer ids"
```

---

### Task 6: MCP authoring and docs for the field

**Files:**
- Modify: `src/core/authoring/models.ts` (the `npc` summary), `src/core/authoring/guides.ts` (NPC guide), `src/core/authoring/examples.ts` (`npcExample` gets a second example or the existing one gains a trainer; add `trainerExample` only if the NPC example would exceed the guide's limits), the MCP prompt `src/main/mcp/prompts.ts` only if it lists NPC fields
- Modify: `site/src/content/docs/guides/npcs-and-objects.md` ("Teaching spells"), `reference/database-tables.md`, `guides/ai-mcp.md`
- Test: extend `tests/core/authoring-guides.test.ts`

**Interfaces:**
- Consumes: `trainer` on the `npc` schema (automatic).

Content: the guide's Fields list gains `trainer` — `null` (not a trainer) or `{ trainerId, type, requirement, greeting, spells }`; `trainerId` from `allocate_ids` kind `trainer`; `type` `class`, `mount`, `profession` or `pet`; `requirement` the class id for `class` (1 warrior, 2 paladin, 3 hunter, 4 rogue, 5 priest, 6 death knight, 7 shaman, 8 mage, 9 warlock, 11 druid; other ids are this fork's own classes) and 0 otherwise; each spell `{ spell, cost (copper), reqLevel, reqSkill, reqSkillRank, reqSpells (up to 3) }`; writing it replaces the whole trainer; an existing NPC arrives with its trainer already in `trainer`; a trainer other NPCs share is locked (`origin.locked` has `trainer`) and is not written: ask the author to use **Give it its own copy** in the editor; stock it never read (no `creature_default_trainer` in `origin.original`) is not written; the fork's older `npc_trainer` lists are shown, not edited. "What the editor checks" lists every new code. Example: a class trainer with two spells. The guide stays within the 6000-character limit (shorten wording, never drop a code).

- [ ] **Step 1: Write the failing tests** — in `tests/core/authoring-guides.test.ts`: extend the regex that checks cited codes to include `TRAINER` (both places), and add

```ts
it('npc guide and example cover trainers and cite their codes', async () => {
  const { examplesOf } = await import('../../src/core/authoring/examples');
  const guide = guideOf('npc');
  for (const word of ['`trainer`', '`trainerId`', '`requirement`', '`reqSpells`', 'allocate_ids', 'Give it its own copy', '`TRAINER_NO_ID`', '`TRAINER_NO_SPELL`', '`TRAINER_DUPLICATE`', '`TRAINER_REQ_SPELL`', '`TRAINER_NO_CLASS`', '`TRAINER_EMPTY`', '`TRAINER_UNKNOWN_SPELL`', '`TRAINER_NOT_READ`', '`TRAINER_ID_TAKEN`']) expect(guide).toContain(word);
  expect(jsonSchemaOf('npc')).toHaveProperty('properties.trainer');
  expect(examplesOf('npc').some((e) => (e.value as { trainer: unknown }).trainer !== null)).toBe(true);
  expect(authoringSummary('npc')).toMatch(/teaches/);
});
```

Also the existing "every choice a model allows is named in code font" test now demands `class`, `mount`, `profession` and `pet` appear as whole words in code font in the guide.

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** the guide/example/summary text and the three docs pages (the site's "Teaching spells" section is finished in Task 9 once the UI wording is final; write it now from the Trainer tab wording in Task 7).
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core/authoring-guides.test.ts tests/core/authoring-models.test.ts tests/main` — Expected: PASS. Then `npm --prefix site run build` — Expected: builds with valid links.
- [ ] **Step 5: Commit**

```bash
git add src site tests
git commit -m "docs: trainers in the NPC guide, example and docs"
```

---

### Task 7: The Trainer tab

**Files:**
- Create: `src/renderer/entities/TrainerList.tsx`, `src/renderer/entities/CopyTrainer.tsx`, `src/core/game/classes.ts` (stock class names)
- Modify: `src/renderer/entities/npc/NpcEditor.tsx` (tab `trainer` after `vendor`; new prop `allocateTrainer`), `src/renderer/entities/EntityEditorHost.tsx` (passes `allocateTrainer={() => allocate('trainer')}`, passes `sharedTrainer` in `ExistingFacts`), `src/renderer/entities/existing-facts.tsx` (`ExistingFacts.sharedTrainer`)
- Test: `tests/renderer/entities-trainer.test.tsx` (create); update the tab list assertions in `tests/renderer/npc-editor.test.tsx` to `['Basics','Look & gear','Fight','Loot','Vendor','Trainer','Placement']` (seven tabs; also the tab-stop test), and `tests/core/classes.test.ts`

**Interfaces:**
- Consumes: `Trainer`, `TrainerSpell`, `TRAINER_TYPES`, `trainerUnread`, `NpcEditor`'s `existing` facts, `EntityField` with `kind="spell"`, `SKILLS` from `src/core/game/skills.ts`, `useApi`, `useProjectEntities`.
- Produces: `CLASSES: readonly { id: number; name: string }[]` and `className(id: number): string` in `src/core/game/classes.ts` — stock ids 1 Warrior, 2 Paladin, 3 Hunter, 4 Rogue, 5 Priest, 6 Death Knight, 7 Shaman, 8 Mage, 9 Warlock, 11 Druid; any other id is `"Class N"`.
- Produces: `TrainerList({ idPrefix, trainer, onChange, onMake, locked })`: `trainer: Trainer`, `onChange(next: Trainer)`; `locked`: `{ others: number; onCopy(): void } | null`.
- Produces: `CopyTrainer({ idPrefix, npcEntry, current, onCopy })`: `onCopy(spells: TrainerSpell[])`.
- Produces: `NpcEditor` prop `allocateTrainer(): Promise<number | null>`.

Behavior (labels are exact; tests rely on them):
- Tab body when `trainerUnread(npc)`: only "{name}'s trainer was not read when it was added to this project, so it is not edited here. Choose Put back as the database has it, then edit it again, to read it."
- Otherwise: if the NPC has no trainer: hint "This NPC teaches nothing." and a **Make this NPC a trainer** button; clicking it calls `allocateTrainer()` and, when it returns an id, sets `trainer = { trainerId, type: 'class', requirement: 0, greeting: '', spells: [] }`; when it returns null shows `role="alert"` "Could not get a free trainer id." and changes nothing. The **Copy spells from…** section is also shown (copying into an NPC with no trainer allocates an id first, then sets the copied spells with `type`, `requirement`, `greeting` copied too).
- With a trainer: **Type** select (Class, Mount, Profession, Pet), **Class** select (only for Class: the `CLASSES` plus "Choose a class" for 0, and the current id as "Class N" when it is not stock), **Greeting** text, then one `scene-step` per spell: heading `Spell N`, **Remove**, a **Spell** `EntityField kind="spell"`, **Cost** as three number fields **Gold**, **Silver**, **Copper** (minimums 0, copper capped to 99 and silver to 99 by carrying into the next unit), **Required level** (0 to 255), **Skill** select (None + `SKILLS`; an id not in the list shown as "Skill N"), **Skill rank**, and **Needs spells**: one `EntityField kind="spell"` labelled "Needs spell 1" (and a second and third appear as the previous is filled), each with a clear; **Add spell** appends a blank spell (`spell: 0`). **Remove trainer** (button) asks `window.confirm` when the trainer has spells, then sets `trainer = null`. Changing Type away from Class sets `requirement` to 0; changing to Class leaves it 0 until a class is chosen.
- Locked (`origin.locked` has `'trainer'` and `existing.sharedTrainer > 0`): the spells are listed read-only (spell id, cost, level), with the warning "{n} other NPC(s) use this trainer: changing it would change theirs too." and **Give it its own copy**, which calls `allocateTrainer()` and then `onChange` with `{ ...npc, trainer: { ...trainer, trainerId: id }, origin: { ...origin, locked: origin.locked without 'trainer' } }`; a null id shows the alert. A locked trainer with `trainer: null` (an unknown type or missing row) shows "Its trainer is one this editor does not edit." only.
- If the NPC has `npc_trainer` rows in `origin.original.npc_trainer` (own rows by `ID`): a hint "Also teaches the spells of N shared list(s) (the older npc_trainer table), which are not edited here." where N = the number of distinct negative `SpellID` includes plus 1 when it has any positive-`SpellID` rows of its own.
- **CopyTrainer**: `EntityField kind="creature"` "Copy spells from…" and **Copy**, same rules and messages as `CopyStock` ("That is this NPC.", "That NPC is not a trainer.", read errors, confirm "Replace this NPC's N spells with the M from NAME?" when it has spells; a project NPC whose trainer was never read (`trainerUnread`) is read from the database instead). It copies the spells, type, class and greeting, never the `trainerId`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/renderer/entities-trainer.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcEditor } from '../../src/renderer/entities/npc/NpcEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { newNpc, type CustomNpc } from '../../src/core/entities/model';

type T = NonNullable<CustomNpc['trainer']>;
const spell = (id: number, over: Partial<T['spells'][number]> = {}) => ({ spell: id, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] as number[], ...over });
const trainer = (over: Partial<T> = {}): T => ({ trainerId: 900033, type: 'class', requirement: 1, greeting: 'Hi', spells: [spell(78)], ...over });
const npcWith = (t: T | null, base: Partial<CustomNpc> = {}): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', trainer: t, ...base });

let current: CustomNpc = newNpc(12000001);
function Live({ start, api = makeMockApi(), allocate = async () => 900033, existing }: { start: CustomNpc; api?: ReturnType<typeof makeMockApi>; allocate?: () => Promise<number | null>; existing?: { sharedLoot: number; spawnCount: number; sharedTrainer: number; locked: readonly ('type' | 'loot' | 'fight' | 'trainer')[] } }) {
  const [npc, setNpc] = useState(start);
  current = npc;
  return <NamesProvider api={api}><NpcEditor npc={npc} onChange={(n) => { current = n; setNpc(n); }} allocateSpawn={async () => 900} allocateTrainer={allocate} existing={existing} tab="trainer" /></NamesProvider>;
}
const steps = () => screen.getAllByRole('listitem');
const chooseSource = async (name: string) => {
  await userEvent.type(screen.getByRole('combobox', { name: 'Copy spells from…' }), name.toLowerCase());
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
};

describe('the Trainer tab', () => {
  it('makes the NPC a trainer with an allocated id', async () => {
    render(<Live start={npcWith(null)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make this NPC a trainer' }));
    expect(current.trainer).toEqual({ trainerId: 900033, type: 'class', requirement: 0, greeting: '', spells: [] });
  });
  it('says so, and changes nothing, when no id could be got', async () => {
    render(<Live start={npcWith(null)} allocate={async () => null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make this NPC a trainer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get a free trainer id.');
    expect(current.trainer).toBeNull();
  });
  it('edits the type, class and greeting; a class only for a class trainer', async () => {
    render(<Live start={npcWith(trainer())} />);
    await userEvent.selectOptions(screen.getByLabelText('Class'), 'Mage');
    expect(current.trainer!.requirement).toBe(8);
    await userEvent.clear(screen.getByLabelText('Greeting'));
    await userEvent.type(screen.getByLabelText('Greeting'), 'Welcome');
    expect(current.trainer!.greeting).toBe('Welcome');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Profession');
    expect(current.trainer).toMatchObject({ type: 'profession', requirement: 0 });
    expect(screen.queryByLabelText('Class')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Class');
    expect(current.trainer).toMatchObject({ type: 'class', requirement: 0 });
  });
  it('shows a class this editor has no name for', () => {
    render(<Live start={npcWith(trainer({ requirement: 12 }))} />);
    expect(within(screen.getByLabelText('Class')).getByRole('option', { name: 'Class 12' })).toBeTruthy();
  });
  it('adds, edits and removes spells', async () => {
    render(<Live start={npcWith(trainer())} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add spell' }));
    expect(current.trainer!.spells).toEqual([spell(78), spell(0)]);
    const second = steps()[1]!;
    fireEvent.change(within(second).getByLabelText('Gold'), { target: { value: '2' } });
    fireEvent.change(within(second).getByLabelText('Silver'), { target: { value: '30' } });
    fireEvent.change(within(second).getByLabelText('Copper'), { target: { value: '4' } });
    expect(current.trainer!.spells[1]!.cost).toBe(20000 + 3000 + 4);
    fireEvent.change(within(second).getByLabelText('Required level'), { target: { value: '300' } });
    expect(current.trainer!.spells[1]!.reqLevel).toBe(255);
    await userEvent.selectOptions(within(second).getByLabelText('Skill'), 'Alchemy');
    fireEvent.change(within(second).getByLabelText('Skill rank'), { target: { value: '75' } });
    expect(current.trainer!.spells[1]).toMatchObject({ reqSkill: 171, reqSkillRank: 75 });
    await userEvent.click(within(steps()[0]!).getByRole('button', { name: 'Remove' }));
    expect(current.trainer!.spells).toHaveLength(1);
    expect(current.trainer!.spells[0]!.reqSkill).toBe(171);
  });
  it('carries copper and silver over into the next unit', () => {
    render(<Live start={npcWith(trainer({ spells: [spell(78)] }))} />);
    fireEvent.change(within(steps()[0]!).getByLabelText('Copper'), { target: { value: '150' } });
    expect(current.trainer!.spells[0]!.cost).toBe(150);
    expect(within(steps()[0]!).getByLabelText('Silver')).toHaveValue(1);
    expect(within(steps()[0]!).getByLabelText('Copper')).toHaveValue(50);
  });
  it('picks the spell and the spells it needs, offering the next only when the last is filled', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async (kind: string) => okv(kind === 'spell' ? [{ id: 133, name: 'Fireball' }] : [])) });
    render(<Live start={npcWith(trainer({ spells: [spell(0)] }))} api={api} />);
    expect(screen.queryByRole('combobox', { name: 'Needs spell 2' })).toBeNull();
    await userEvent.type(within(steps()[0]!).getByRole('combobox', { name: 'Needs spell 1' }), 'fire');
    await userEvent.click(await screen.findByRole('option', { name: /Fireball/ }));
    expect(current.trainer!.spells[0]!.reqSpells).toEqual([133]);
    expect(within(steps()[0]!).getByRole('combobox', { name: 'Needs spell 2' })).toBeTruthy();
  });
  it('removes the trainer after asking, when it has spells', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Live start={npcWith(trainer())} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove trainer' }));
    expect(current.trainer).not.toBeNull();
    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove trainer' }));
    expect(current.trainer).toBeNull();
  });
  it('copies another NPC\'s spells, type, class and greeting, never its id, asking before replacing', async () => {
    const source = npcWith(trainer({ trainerId: 17, type: 'class', requirement: 3, greeting: 'Hunter!', spells: [spell(1), spell(2)] }), { entry: 68, name: 'Guard' });
    const api = makeMockApi({ readExistingEntity: vi.fn(async () => okv(source)), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={npcWith(trainer())} api={api} />);
    await chooseSource('Guard');
    expect(confirm).toHaveBeenCalled();
    expect(current.trainer).toEqual({ trainerId: 900033, type: 'class', requirement: 3, greeting: 'Hunter!', spells: [spell(1), spell(2)] });
  });
  it('copies into an NPC that is not a trainer by allocating an id', async () => {
    const source = npcWith(trainer({ trainerId: 17, spells: [spell(1)] }), { entry: 68, name: 'Guard' });
    const api = makeMockApi({ readExistingEntity: vi.fn(async () => okv(source)), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])) });
    const allocate = vi.fn(async () => 900050);
    render(<Live start={npcWith(null)} api={api} allocate={allocate} />);
    await chooseSource('Guard');
    expect(allocate).toHaveBeenCalled();
    expect(current.trainer).toMatchObject({ trainerId: 900050, spells: [spell(1)] });
  });
  it('does not copy from itself or from an NPC that is not a trainer', async () => {
    const api = makeMockApi({ readExistingEntity: vi.fn(async () => okv({ ...newNpc(68), name: 'Guard' })), searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }, { id: 12000001, name: 'Hela' }])) });
    render(<Live start={npcWith(trainer())} api={api} />);
    await chooseSource('Guard');
    expect(await screen.findByRole('alert')).toHaveTextContent('That NPC is not a trainer.');
    expect(current.trainer!.spells).toEqual([spell(78)]);
  });
  it('locks a trainer other NPCs share and gives the NPC its own copy', async () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [{ CreatureId: '12000001', TrainerId: '17' }], trainer: [], trainer_spell: [] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 30, locked: ['trainer' as const] };
    render(<Live start={npcWith(trainer({ trainerId: 17 }), { origin })} existing={{ sharedLoot: 0, spawnCount: 1, sharedTrainer: 30, locked: ['trainer'] }} />);
    expect(screen.getByText(/30 other NPCs use this trainer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add spell' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Give it its own copy' }));
    expect(current.trainer!.trainerId).toBe(900033);
    expect(current.trainer!.spells).toEqual([spell(78)]);
    expect((current.origin as { locked: string[] }).locked).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Add spell' })).toBeTruthy();
  });
  it('notes the older shared lists an NPC also uses', () => {
    const origin = { kind: 'existing' as const, original: { creature_default_trainer: [], trainer: [], trainer_spell: [], npc_trainer: [{ ID: '198', SpellID: '-200007' }, { ID: '198', SpellID: '-200008' }, { ID: '198', SpellID: '-200007' }] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] };
    render(<Live start={npcWith(null, { origin })} existing={{ sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] }} />);
    expect(screen.getByText(/Also teaches the spells of 2 shared lists/)).toBeTruthy();
  });
  it('leaves the trainer of a project saved before trainers alone', () => {
    const old = npcWith(null, { origin: { kind: 'existing', original: { creature_template: [{ entry: '54' }] }, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] } });
    render(<Live start={old} existing={{ sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] }} />);
    expect(screen.getByText(/trainer was not read/i)).toBeTruthy();
    expect(screen.getByText(/put back as the database has it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make this NPC a trainer' })).toBeNull();
  });
});
```

`tests/core/classes.test.ts`: `className(2)` is `'Paladin'`, `className(12)` is `'Class 12'`, `CLASSES` has the ten stock ids and is sorted by id.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/classes.test.ts tests/renderer/entities-trainer.test.tsx tests/renderer/npc-editor.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the components, class list, NpcEditor tab and host wiring per the Behavior block; reuse the `scene-*` classes and `formatCoin` is not needed here (money is three fields). Add `sharedTrainer` to `ExistingFacts` and make `existing` objects built elsewhere pass it (the host reads `entity.origin.sharedTrainer`).
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/renderer tests/core && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(renderer): Trainer tab for NPCs"
```

---

### Task 8: Right-click menu

**Files:**
- Modify: `src/core/entities/entity.ts` (`NpcSpawn.trainer: { teaches: boolean; count: number | null }`), `src/renderer/world3d/menu/subject.ts`, `src/renderer/world3d/menu/model.ts` (`MenuEditorTab` gains `'trainer'`), `src/renderer/world3d/menu/sections/index.ts`
- Create: `src/renderer/world3d/menu/sections/trainer.ts`
- Test: extend `tests/renderer/world3d-menu-sections.test.ts`, `tests/renderer/world3d-menu-subject.test.ts`, `tests/renderer/world3d-menu-vendor-open.test.tsx` (add a trainer case), update the section-order assertion and the world-group item lists that now include the new item

**Interfaces:**
- `spawnedEntityOf(info, store)` for an NPC: when the project holds it and its trainer was read (`!trainerUnread`), `trainer = { teaches: stored.trainer !== null, count: stored.trainer?.spells.length ?? 0 }`; otherwise `{ teaches: ((info.npcFlags ?? 0) & 16) !== 0, count: null }`.
- Section `trainer` (id `'trainer'`, group `'world'`, NPC spawns only, registered right after `vendor`): label `Edit trainer spells…` when `trainer.teaches`, else `Make trainer…`; an existing NPC offline gets `disabledReason: NEEDS_DATABASE`; the hint is `"N spells"` (`"1 spell"`) when `count` is above 0; action `{ kind: 'editEntity', spawn: info, tab: 'trainer' }`.

- [ ] **Step 1: Write the failing tests** (reusing helpers already in the test file: `npc`, `hela`, `store`, `on`, `context`, `item`, `buildMenu`):

```ts
describe('the trainer section', () => {
  const lesson = { spell: 78, cost: 0, reqLevel: 0, reqSkill: 0, reqSkillRank: 0, reqSpells: [] };
  const taught = (n: number): ProjectEntities => ({ ...store, npcs: [{ ...newNpc(12000001), name: 'Hela', trainer: { trainerId: 900033, type: 'class', requirement: 1, greeting: '', spells: Array.from({ length: n }, () => lesson) } }] });

  it('offers Make trainer… on an NPC that teaches nothing, opening the Trainer tab', () => {
    const entry = item(buildMenu(on(hela), context()), 'Make trainer…')!;
    expect(entry.action).toEqual({ kind: 'editEntity', spawn: hela, tab: 'trainer' });
    expect(entry.hint).toBeUndefined();
  });
  it('offers Edit trainer spells… with the count on a project trainer', () => {
    expect(item(buildMenu(on(hela, taught(2)), context()), 'Edit trainer spells…')!.hint).toBe('2 spells');
    expect(item(buildMenu(on(hela, taught(1)), context()), 'Edit trainer spells…')!.hint).toBe('1 spell');
    expect(item(buildMenu(on(hela, taught(2)), context()), 'Make trainer…')).toBeUndefined();
  });
  it('reads an unopened database NPC from the trainer bit of its flags', () => {
    expect(item(buildMenu(on(npc({ npcFlags: 51 })), context()), 'Edit trainer spells…')!.hint).toBeUndefined();
    expect(item(buildMenu(on(npc({ npcFlags: 129 })), context()), 'Make trainer…')).toBeDefined();
    expect(item(buildMenu(on(npc()), context()), 'Make trainer…')).toBeDefined();
  });
  it('needs the world database for a database NPC, not for a project one; not on objects', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Make trainer…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Make trainer…')!.action).toBeDefined();
    expect(item(buildMenu(on(chest), context()), 'Make trainer…')).toBeUndefined();
  });
  it('stock the project never read falls back to the flags', () => {
    const unread = { ...store, npcs: [{ ...newNpc(1423), origin: { kind: 'existing' as const, original: {}, sharedLoot: 0, spawnCount: 1, sharedTrainer: 0, locked: [] } }] };
    expect(item(buildMenu(on(npc({ npcFlags: 51 }), unread), context()), 'Edit trainer spells…')).toBeDefined();
    expect(item(buildMenu(on(npc({ npcFlags: 3 }), unread), context()), 'Make trainer…')).toBeDefined();
  });
});
```

In `tests/renderer/world3d-menu-vendor-open.test.tsx` add a second case with `npcFlags: 51`: the item `Edit trainer spells…` calls `onEditEntity('creature', 1423, 'trainer')`. In the subject test, add the same rows as the vendor ones for `trainer`.

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.** `WorldWorkspace.editEntity` already carries the tab; only the `MenuEditorTab` union grows.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/renderer && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(world): Make trainer… and Edit trainer spells… in the right-click menu"
```

---

### Task 9: Real-database check, docs and final verification

**Files:**
- Create: `tests/integration/trainer-read.int.test.ts`
- Modify: `site/src/content/docs/guides/npcs-and-objects.md` (finish "Teaching spells" with the final Trainer tab wording), `guides/the-world.md` (the menu items), `reference/database-tables.md`
- Test: the whole suite, the integration test, the docs build

**Interfaces:** none new.

- [ ] **Step 1: Write the integration test** modelled on `tests/integration/mysql-world-db.int.test.ts` (same connection helper and skip behavior when no MySQL is configured; point it at the schema named by the same environment variables the other integration tests use — `ACQC_WORLD_DB_*`, which hold the `acore_world` login in `.env`; never write credentials into a file). It opens the world DB, calls `readExistingRows(db, 'npc', entry)` then `npcFromRows`, and asserts, for entries it finds by query rather than by hard-coded id (the fork's ids may differ): (a) an NPC from `creature_default_trainer` whose `trainer.Type` is 0 reads `trainer.type === 'class'`, `requirement > 0` and at least one spell, with `origin.sharedTrainer` equal to the count of other NPCs with the same `TrainerId`; (b) a trainer used by more than one NPC reads `locked` containing `'trainer'`; (c) an NPC with `Type` 2 reads `profession` and `requirement` 0; (d) an NPC that has `npc_trainer` rows reads `origin.original.npc_trainer` non-empty; (e) running `existingStatements` over each of (a)–(d) read unchanged yields no `creature_default_trainer`, `trainer` or `trainer_spell` statements and the same `npcflag` as the row had; (f) making a read NPC's trainer an own copy (new id above `selectMax('trainer','Id')`) yields statements whose keys never include the original trainer id.
- [ ] **Step 2: Run it** — `npx vitest run --config vitest.int.config.ts tests/integration/trainer-read.int.test.ts` with the world database environment variables set — Expected: PASS against `acore_world`; if a precondition is missing from the data (for example no profession trainer), the test names which one and skips that assertion rather than failing.
- [ ] **Step 3: Finish the docs** to match the shipped wording: the Trainer tab's labels (**Make this NPC a trainer**, **Type**, **Class**, **Greeting**, **Add spell**, **Cost** in gold/silver/copper, **Required level**, **Skill**, **Skill rank**, **Needs spell**, **Copy spells from…**, **Remove trainer**, **Give it its own copy**), the class rule (a class trainer needs a class, or no player can use it), shared trainers, the `npc_trainer` note, and the menu items **Make trainer…** and **Edit trainer spells…**. Update `database-tables.md` with a "Trainers" row listing `creature_default_trainer`, `trainer`, `trainer_spell` and the trainer bit of `npcflag`.
- [ ] **Step 4: Run the whole verification** — `npm run typecheck && npx vitest run` then `npm --prefix site run build` — Expected: all green, docs links valid.
- [ ] **Step 5: Commit**

```bash
git add tests site
git commit -m "docs: NPC trainers; test: reading real trainers"
```
