# NPC gossip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author give any NPC (new or existing) a gossip menu tree: a greeting and options that close the window, open another menu, or open a service window; shared menus are locked and copyable.

**Architecture:** `CustomNpc` gains a nullable `gossipMenu` ({ menus }), root menu first. Existing NPCs read their tree (root and the menus its options open) from `gossip_menu`, `gossip_menu_option` and `npc_text` into it, keep the rows in `origin.original`, and write back only changed, unlocked menus through the existing `writeTable` machinery, keying options one by one. New NPCs compile the same rows. The UI is a Gossip tab built like the Trainer tab, plus a right-click section.

**Tech Stack:** TypeScript, zod, React, Electron (main/renderer), vitest (+ jsdom), MySQL world DB behind `WorldDb` (fake `forkDb()` in tests; the real `acore_world` for one integration test).

**Spec:** `docs/superpowers/specs/2026-10-09-npc-gossip-design.md`

**Base:** builds on the vendors and trainers work (`feat/npc-vendors`, `feat/npc-trainers`) and reuses what they added: `vendorUnread`/`trainerUnread` and `sameVendor`/`sameTrainer` in `src/core/entities/model.ts`, `NpcSpawn.vendor`/`.trainer`, `MenuEditorTab`, the menu `hint`, `ViewCreature.npcFlags`/`SpawnInfo.npcFlags`, `TrainerTab`/`CopyTrainer`, `trainerUsers`-style live counts in `src/main/api/checks.ts`, and the generic "new rows of an edited existing NPC take the table's defaults" step in `src/main/api/patches.ts`. Execute on a branch cut from `feat/npc-trainers` (already `feat/npc-gossip`).

## Lessons from the vendor and trainer reviews (built in from the start)

Each is a defect found in review on the earlier work; every task below already covers it, and the final review checks each again.
- New rows written for an existing NPC must render: add an export test for each new-row flow (Tasks 2 and 9), not only statement-level tests.
- An id must be the NPC's own: ownership is decided per NPC from the live users of the id, never from "some project NPC links it" (Task 4).
- The lock is a snapshot and is client-editable: a live re-count blocks writing over a menu others use (`GOSSIP_SHARED`), and an edit to a locked menu warns (`GOSSIP_LOCKED`) (Task 4).
- A re-export must never delete rows other NPCs use, even when a new NPC's entry collides with a real creature (Task 3).
- An unchanged, unlocked existing menu is not validated (the database's quirks are not the author's to fix) (Task 4).
- Removing the link of a shared menu must stay possible (Tasks 2 and 7).
- Allocation must count dangling references (Task 5).
- A NULL column stays NULL until written (Task 2).
- The menu falls back to flags for anything the editor could not model (Task 8).

## Global Constraints

- Tables and columns (checked against `acore_world`, 2026-10-09): `gossip_menu(MenuID+TextID PK)`; `npc_text(ID PK; text{0..7}_0, text{0..7}_1, BroadcastTextID{0..7}, lang{0..7}, Probability{0..7}, em{0..7}_0..5, VerifiedBuild)`; `gossip_menu_option(MenuID+OptionID PK; OptionIcon, OptionText, OptionBroadcastTextID, OptionType, OptionNpcFlag, ActionMenuID, ActionPoiID, BoxCoded, BoxMoney, BoxText, BoxBroadcastTextID, VerifiedBuild)`; `creature_template.gossip_menu_id`; conditions of source type 14 (menu text: `SourceGroup` menu, `SourceEntry` text) and 15 (option: `SourceGroup` menu, `SourceEntry` option); `smart_scripts` event 62 (gossip select: `event_param1` menu, `event_param2` option, `source_type` 0).
- Model (zod, `src/core/entities/model.ts`): `gossipAction = {kind:'close'} | {kind:'menu', menuId: int.positive()} | {kind:'service', type: int.min(0), npcFlag: int.min(0)}`; `textVariant = { text: string, textFemale: string, probability: num.min(0) }`; `gossipOption = { optionId: int.min(0), icon: int.min(0), text: string, action, kept: boolean }`; `gossipMenu = { menuId: int, textId: int, greeting: array(textVariant).min(1).max(8), options: array(gossipOption), locked: boolean }`; `gossipTree = { menus: array(gossipMenu).min(1) }`; `CustomNpc.gossipMenu: gossipTree.nullable().default(null)`. The existing `gossip: boolean` (Can be talked to) is unrelated and unchanged.
- Service presets `(OptionType, OptionNpcFlag, Icon)`: vendor (3,128,1), flight master (4,8192,2), trainer (5,16,3), innkeeper (8,65536,5), banker (9,131072,6), petitions (10,262144,7), tabard designer (11,524288,8), battlemaster (12,1048576,9), auctioneer (13,2097152,6), stable master (14,4194304,0), armorer (15,4096,1), unlearn talents (16,16,0). Close/plain talk is (1,1,0). Any other pair is shown as "Other (type N, flag M)".
- Reading an option's action: `ActionMenuID > 0` is `menu`; else type 1 with flag 1 is `close`; else `service { type, npcFlag }`. An option whose action is unchanged keeps its original `OptionType` and `OptionNpcFlag` on write.
- Ids are pinned: `menuId`/`textId` allocated once or read; an existing option keeps its `optionId`; a new option gets the menu's highest `optionId` + 1, never a freed id.
- Tree read: the root menu and every menu its options open, transitively, each once, at most 24 menus; an option opening a menu that was not loaded keeps `{kind:'menu', menuId}`.
- A menu is `locked` when another creature or a gameobject (type 2 `Data3`) uses it, or its text is used by a menu outside this tree, or it has more than one `gossip_menu` row, or a type-14 condition names it, or its text row is missing. A locked menu is never written. An option is `kept` when a type-15 condition or a gossip-select script names it: it cannot be removed, its action cannot change, its text and icon can.
- Opening an NPC changes nothing. Options are keyed `(MenuID, OptionID)` one by one on write, never by whole menu; text rows by `ID`; menu rows by `(MenuID, TextID)`. `conditions` and `smart_scripts` are never written.
- An edited text clears its `BroadcastTextID`; a text or option left as read keeps it.
- A project whose `origin.original` has no `gossip_menu` key (saved before this change, or a fork without the gossip tables) has its gossip left alone.
- Out of scope: scripts, conditions, translations, `Box*`/`ActionPoiID` editing, object gossip.
- Commit messages: conventional style, no attribution lines. Run `npm test` and `npm run typecheck` before each commit that touches shared types.
- Source edits via the Edit tool; avoid shell heredocs for TypeScript containing quotes.

## File Structure

- Model and helpers: `src/core/entities/model.ts`.
- Reading: `src/core/entities/from-rows.ts` (`gossipOf`), `src/core/entities/existing.ts` (`readOriginalRows`), `src/main/entities/existing.ts` (shared counts).
- Writing: `src/core/entities/existing.ts` (`writeGossip`); new NPCs: `compile.ts`, `context.ts`, `src/core/scripts/statements.ts`.
- Checks: `validate.ts`, `src/main/api/checks.ts`.
- Services table and helpers: `src/core/game/gossip-services.ts` (create).
- UI: `src/renderer/entities/GossipTab.tsx`, `GossipMenuEditor.tsx`, `CopyGossip.tsx` (create); `NpcEditor.tsx`.
- Menu: `src/renderer/world3d/menu/sections/gossip.ts` (create).

---

### Task 1: Model, the services table, reading an NPC's gossip tree

**Files:**
- Create: `src/core/game/gossip-services.ts`
- Modify: `src/core/entities/model.ts` (schemas, `gossipMenu` on `npcFields`, `newNpc`, `gossipUnread`, `sameGossip`), `src/core/entities/from-rows.ts` (`ExistingCounts`, `gossipOf`, `npcFromRows`), `src/core/entities/existing.ts` (`readOriginalRows`), `src/main/entities/existing.ts` (shared counts), `src/main/api/entities-api.ts` (counts), `tests/helpers/fixtures.ts` (add any of `gossip_menu`, `gossip_menu_option`, `npc_text`, `conditions`, `smart_scripts`, `gameobject_template` not already in the fake's tables)
- Test: `tests/core/gossip-services.test.ts`, `tests/core/entities-gossip-read.test.ts` (create), extend `tests/main/api-existing.test.ts`

**Interfaces:**
- Produces (`gossip-services.ts`): `interface GossipService { id: string; label: string; type: number; npcFlag: number; icon: number }`; `GOSSIP_SERVICES: readonly GossipService[]` (the twelve presets above, ids `vendor`, `flight`, `trainer`, `inn`, `bank`, `petition`, `tabard`, `battlemaster`, `auction`, `stable`, `armorer`, `unlearn`); `serviceOf(type: number, npcFlag: number): GossipService | undefined`; `serviceLabel(type: number, npcFlag: number): string` — the preset's label or `"Other (type N, flag M)"`; `NPC_FLAG_OF_SERVICE`: not needed (the preset carries `npcFlag`).
- Produces (`model.ts`): `gossipActionSchema`, `textVariantSchema`, `gossipOptionSchema`, `gossipMenuSchema`, `gossipTreeSchema`; types `GossipAction`, `TextVariant`, `GossipOption`, `GossipMenu`, `GossipTree`; `CustomNpc.gossipMenu: GossipTree | null`; `newNpc(entry).gossipMenu === null`; `gossipUnread(npc): boolean` (existing NPC whose `origin.original` has no own key `gossip_menu`); `sameGossip(a: GossipTree | null, b: GossipTree | null): boolean` — by value, menus and options in order, `locked` ignored.
- Produces (`from-rows.ts`): `ExistingCounts` gains `sharedMenus?: Readonly<Record<number, number>>` (menu id to the number of OTHER users: creatures and gameobjects) and `sharedTexts?: Readonly<Record<number, number>>` (text id to the number of menus outside this tree that use it); `npcFromRows` fills `gossipMenu`.
- Produces (`existing.ts`): `readOriginalRows(db, 'npc', entry)` includes, when the tables exist: `gossip_menu` (rows of every tree menu), `gossip_menu_option`, `npc_text` (the texts those menus name), `conditions` (only source types 14 and 15 whose `SourceGroup` is a tree menu) and `smart_scripts` (only `source_type` 0, `event_type` 62, `event_param1` a tree menu). The root is `creature_template.gossip_menu_id`; with 0 no gossip keys but the (empty) `gossip_menu`, `gossip_menu_option`, `npc_text` arrays are still present so the NPC counts as read.
- Produces (main): `readExistingRows(...)` result gains `sharedMenus` and `sharedTexts` as above (creatures from `creature_template.gossip_menu_id`, objects from `gameobject_template` where `type = 2` and `Data3` is the menu, texts from `gossip_menu` rows whose `MenuID` is not in the tree); `entities-api` passes them into the counts.

Behavior of `gossipOf(rows, counts)`: no root (`creature_template.gossip_menu_id` is 0 or missing) gives `null`. Menus in discovery order (root first, then each newly met `ActionMenuID` in option order, breadth-first). Per menu: `menuId`; the first `gossip_menu` row's `TextID` as `textId` (0 when none); `greeting` from the `npc_text` row: variant `i` counts when `Probability{i} > 0` or `text{i}_0` or `text{i}_1` is non-empty, up to the last such variant, at least one (a missing text row reads one blank variant `probability: 1`); options by `OptionID` ascending; `kept` per the Global Constraints; `locked` per the Global Constraints. Numbers via a safe parse (missing is 0); `probability` is a number (may be fractional).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/gossip-services.test.ts
import { describe, expect, it } from 'vitest';
import { GOSSIP_SERVICES, serviceLabel, serviceOf } from '../../src/core/game/gossip-services';

describe('gossip services', () => {
  it('names the twelve services by the type and flag pair the database uses', () => {
    expect(GOSSIP_SERVICES).toHaveLength(12);
    expect(serviceOf(3, 128)).toMatchObject({ id: 'vendor', label: 'Vendor', icon: 1 });
    expect(serviceOf(5, 16)).toMatchObject({ id: 'trainer', icon: 3 });
    expect(serviceOf(8, 65536)).toMatchObject({ id: 'inn' });
    expect(serviceOf(16, 16)).toMatchObject({ id: 'unlearn' });
  });
  it('has no service for a pair it does not know, and labels it as other', () => {
    expect(serviceOf(3, 1)).toBeUndefined();
    expect(serviceLabel(20, 1)).toBe('Other (type 20, flag 1)');
    expect(serviceLabel(3, 128)).toBe('Vendor');
  });
  it('gives each service a distinct pair', () => {
    expect(new Set(GOSSIP_SERVICES.map((s) => `${s.type}/${s.npcFlag}`)).size).toBe(12);
  });
});
```

```ts
// tests/core/entities-gossip-read.test.ts
import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { readOriginalRows } from '../../src/core/entities/existing';
import { gossipUnread, newNpc, projectEntitiesSchema, readProjectEntities, sameGossip } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';
import { forkDb } from '../helpers/fixtures';

const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const template = { entry: '1423', name: 'Guard', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '129', lootid: '0', AIName: '', ScriptName: '', gossip_menu_id: '5000' };
const menu = (id: string, text: string) => ({ MenuID: id, TextID: text });
const text = (id: string, over: Record<string, string> = {}) => ({ ID: id, text0_0: 'Hello', text0_1: 'Hello, lady', BroadcastTextID0: '123', lang0: '0', Probability0: '1', text1_0: '', text1_1: '', BroadcastTextID1: '0', Probability1: '0', VerifiedBuild: '12340', ...over });
const option = (menuId: string, id: string, over: Record<string, string | null> = {}) => ({ MenuID: menuId, OptionID: id, OptionIcon: '0', OptionText: 'Option', OptionBroadcastTextID: '0', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0', ActionPoiID: '0', BoxCoded: '0', BoxMoney: '0', BoxText: null, BoxBroadcastTextID: '0', VerifiedBuild: '12340', ...over });
const rows = {
  creature_template: [template],
  gossip_menu: [menu('5000', '7000'), menu('5001', '7001')],
  npc_text: [text('7000'), text('7001', { text0_0: 'Farewell', text0_1: '', BroadcastTextID0: '0' })],
  gossip_menu_option: [
    option('5000', '1', { OptionText: 'Tell me more', ActionMenuID: '5001' }),
    option('5000', '0', { OptionText: 'Browse your wares', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128', OptionBroadcastTextID: '55' }),
    option('5001', '0', { OptionText: 'Goodbye' }),
  ],
  conditions: [] as Record<string, string>[],
  smart_scripts: [] as Record<string, string>[],
};

describe('reading an existing NPC\'s gossip tree', () => {
  it('reads the root and the menus its options open, with greeting variants and options by id', () => {
    const npc = npcFromRows(1423, rows, counts);
    expect(npc.gossipMenu!.menus.map((m) => m.menuId)).toEqual([5000, 5001]);
    expect(npc.gossipMenu!.menus[0]).toEqual({
      menuId: 5000, textId: 7000, locked: false,
      greeting: [{ text: 'Hello', textFemale: 'Hello, lady', probability: 1 }],
      options: [
        { optionId: 0, icon: 1, text: 'Browse your wares', action: { kind: 'service', type: 3, npcFlag: 128 }, kept: false },
        { optionId: 1, icon: 0, text: 'Tell me more', action: { kind: 'menu', menuId: 5001 }, kept: false },
      ],
    });
    expect(npc.gossipMenu!.menus[1]!.options).toEqual([{ optionId: 0, icon: 0, text: 'Goodbye', action: { kind: 'close' }, kept: false }]);
    expect(npc.origin).toMatchObject({ kind: 'existing', original: rows });
  });

  it('reads several weighted variants up to the last used one, and a blank one for a missing text row', () => {
    const many = { ...rows, npc_text: [text('7000', { text1_0: 'Again', Probability1: '0.5' }), text('7001')] };
    expect(npcFromRows(1423, many, counts).gossipMenu!.menus[0]!.greeting).toEqual([
      { text: 'Hello', textFemale: 'Hello, lady', probability: 1 },
      { text: 'Again', textFemale: '', probability: 0.5 },
    ]);
    const missing = npcFromRows(1423, { ...rows, npc_text: [text('7001')] }, counts).gossipMenu!.menus[0]!;
    expect(missing.greeting).toEqual([{ text: '', textFemale: '', probability: 1 }]);
    expect(missing.locked).toBe(true);
  });

  it('is null for an NPC with no menu or whose gossip was not read', () => {
    expect(npcFromRows(1423, { ...rows, creature_template: [{ ...template, gossip_menu_id: '0' }] }, counts).gossipMenu).toBeNull();
    expect(npcFromRows(1423, { creature_template: [template] }, counts).gossipMenu).toBeNull();
  });

  it('follows a loop once and stops at 24 menus, keeping the rest as bare ids', () => {
    const loop = { ...rows, gossip_menu_option: [option('5000', '0', { ActionMenuID: '5001' }), option('5001', '0', { ActionMenuID: '5000' })] };
    expect(npcFromRows(1423, loop, counts).gossipMenu!.menus).toHaveLength(2);
    const ids = Array.from({ length: 30 }, (_, i) => String(6000 + i));
    const chain = {
      creature_template: [{ ...template, gossip_menu_id: ids[0]! }],
      gossip_menu: ids.map((id, i) => menu(id, String(8000 + i))),
      npc_text: ids.map((_, i) => text(String(8000 + i))),
      gossip_menu_option: ids.map((id, i) => option(id, '0', { ActionMenuID: ids[i + 1] ?? '0' })),
    };
    const tree = npcFromRows(1423, chain, counts).gossipMenu!;
    expect(tree.menus).toHaveLength(24);
    expect(tree.menus[23]!.options[0]!.action).toEqual({ kind: 'menu', menuId: 6024 });
  });

  it('locks a menu others use, one whose text others use, one with several text rows, one with a text condition, and one with no text row', () => {
    const shared = npcFromRows(1423, rows, { ...counts, sharedMenus: { 5000: 2 } }).gossipMenu!.menus;
    expect(shared.map((m) => m.locked)).toEqual([true, false]);
    expect(npcFromRows(1423, rows, { ...counts, sharedTexts: { 7001: 1 } }).gossipMenu!.menus.map((m) => m.locked)).toEqual([false, true]);
    const twoTexts = { ...rows, gossip_menu: [menu('5000', '7000'), menu('5000', '7002'), menu('5001', '7001')] };
    expect(npcFromRows(1423, twoTexts, counts).gossipMenu!.menus[0]).toMatchObject({ textId: 7000, locked: true });
    const conditioned = { ...rows, conditions: [{ SourceTypeOrReferenceId: '14', SourceGroup: '5000', SourceEntry: '7000' }] };
    expect(npcFromRows(1423, conditioned, counts).gossipMenu!.menus.map((m) => m.locked)).toEqual([true, false]);
  });

  it('keeps an option a condition or a gossip-select script names', () => {
    const tied = {
      ...rows,
      conditions: [{ SourceTypeOrReferenceId: '15', SourceGroup: '5000', SourceEntry: '1' }],
      smart_scripts: [{ entryorguid: '1423', source_type: '0', event_type: '62', event_param1: '5000', event_param2: '0' }],
    };
    expect(npcFromRows(1423, tied, counts).gossipMenu!.menus[0]!.options.map((o) => o.kept)).toEqual([true, true]);
    expect(npcFromRows(1423, rows, counts).gossipMenu!.menus[0]!.options.map((o) => o.kept)).toEqual([false, false]);
  });

  it('a new NPC and one saved before gossip have no menu; bad values are refused', () => {
    expect(newNpc(1).gossipMenu).toBeNull();
    const { gossipMenu: _g, ...old } = newNpc(7);
    expect(readProjectEntities({ npcs: [old], objects: [], items: [] }).npcs[0]!.gossipMenu).toBeNull();
    const menuOf = (over: object) => ({ ...newNpc(7), gossipMenu: { menus: [{ menuId: 1, textId: 2, greeting: [{ text: 'Hi', textFemale: '', probability: 1 }], options: [], locked: false, ...over }] } });
    const ok = (npc: object) => projectEntitiesSchema.safeParse({ npcs: [npc], objects: [], items: [] }).success;
    expect(ok(menuOf({}))).toBe(true);
    expect(ok(menuOf({ greeting: [] }))).toBe(false);
    expect(ok(menuOf({ greeting: Array.from({ length: 9 }, () => ({ text: 'x', textFemale: '', probability: 1 })) }))).toBe(false);
    expect(ok(menuOf({ options: [{ optionId: 0, icon: 0, text: 'x', action: { kind: 'menu', menuId: 0 }, kept: false }] }))).toBe(false);
  });

  it('knows gossip never read from gossip that was, and compares trees by value', () => {
    const npc = npcFromRows(1423, rows, counts);
    expect(gossipUnread(npc)).toBe(false);
    const { gossip_menu: _k, ...unread } = rows;
    expect(gossipUnread(npcFromRows(1423, unread, counts))).toBe(true);
    expect(gossipUnread(newNpc(1))).toBe(false);
    const again = npcFromRows(1423, rows, counts).gossipMenu;
    expect(sameGossip(npc.gossipMenu, again)).toBe(true);
    expect(sameGossip(npc.gossipMenu, null)).toBe(false);
    expect(sameGossip(null, null)).toBe(true);
    const edited = structuredClone(again!);
    edited.menus[0]!.options[0]!.text = 'Changed';
    expect(sameGossip(npc.gossipMenu, edited)).toBe(false);
    const lockedOnly = structuredClone(again!);
    lockedOnly.menus[0]!.locked = true;
    expect(sameGossip(npc.gossipMenu, lockedOnly)).toBe(true);
  });
});

describe('the rows an existing NPC\'s gossip is read from', () => {
  const fill = (db: FakeWorldDb) => {
    db.insert('creature_template', template);
    db.insert('gossip_menu', menu('5000', '7000'));
    db.insert('gossip_menu', menu('5001', '7001'));
    db.insert('gossip_menu', menu('9999', '7999'));
    db.insert('npc_text', { ID: '7000', text0_0: 'Hello', Probability0: '1' });
    db.insert('npc_text', { ID: '7001', text0_0: 'Farewell', Probability0: '1' });
    db.insert('npc_text', { ID: '7999', text0_0: 'Elsewhere', Probability0: '1' });
    db.insert('gossip_menu_option', { MenuID: '5000', OptionID: '0', OptionText: 'More', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '5001' });
    db.insert('gossip_menu_option', { MenuID: '5001', OptionID: '0', OptionText: 'Bye', OptionType: '1', OptionNpcFlag: '1' });
    db.insert('gossip_menu_option', { MenuID: '9999', OptionID: '0', OptionText: 'Elsewhere', OptionType: '1', OptionNpcFlag: '1' });
    db.insert('conditions', { SourceTypeOrReferenceId: '15', SourceGroup: '5000', SourceEntry: '0' });
    db.insert('conditions', { SourceTypeOrReferenceId: '15', SourceGroup: '9999', SourceEntry: '0' });
    db.insert('conditions', { SourceTypeOrReferenceId: '19', SourceGroup: '5000', SourceEntry: '0' });
    db.insert('smart_scripts', { entryorguid: '1423', source_type: '0', id: '0', link: '0', event_type: '62', event_param1: '5001', event_param2: '0' });
    db.insert('smart_scripts', { entryorguid: '1423', source_type: '0', id: '1', link: '0', event_type: '4', event_param1: '5001', event_param2: '0' });
  };

  it('reads the tree\'s menu, option and text rows, and only the conditions and scripts that name those menus', async () => {
    const db = forkDb();
    fill(db);
    const read = await readOriginalRows(db, 'npc', 1423);
    expect(read!.gossip_menu!.map((r) => r.MenuID)).toEqual(['5000', '5001']);
    expect(read!.gossip_menu_option!.map((r) => `${r.MenuID}/${r.OptionID}`)).toEqual(['5000/0', '5001/0']);
    expect(read!.npc_text!.map((r) => r.ID)).toEqual(['7000', '7001']);
    expect(read!.conditions!.map((r) => `${r.SourceTypeOrReferenceId}/${r.SourceGroup}`)).toEqual(['15/5000']);
    expect(read!.smart_scripts!.map((r) => `${r.event_type}/${r.event_param1}`)).toEqual(['62/5001']);
  });

  it('reads empty gossip lists for an NPC with no menu, so it counts as read', async () => {
    const db = forkDb();
    fill(db);
    db.insert('creature_template', { ...template, entry: '999', gossip_menu_id: '0' });
    const read = await readOriginalRows(db, 'npc', 999);
    expect(read).toMatchObject({ gossip_menu: [], gossip_menu_option: [], npc_text: [] });
  });

  it('leaves the keys out when the fork has no gossip tables, so gossip is never written', async () => {
    const db = FakeWorldDb.fromFork(['creature_template', 'creature_template_model', 'creature_equip_template', 'creature_loot_template', 'creature', 'game_event_creature']);
    db.insert('creature_template', template);
    const read = await readOriginalRows(db, 'npc', 1423);
    for (const key of ['gossip_menu', 'gossip_menu_option', 'npc_text']) expect(read).not.toHaveProperty(key);
  });
});
```

Extend `tests/main/api-existing.test.ts` (it builds a fake world DB in `setup()`): insert `gossip_menu` rows `5000→7000` and `5001→7001`, their `npc_text`, a root option opening 5001, `creature_template.gossip_menu_id = 5000` on NPC 1423, the same `gossip_menu_id = 5000` on NPC 68, a `gameobject_template` row (`type 2`, `Data3 5001`), and a second `gossip_menu` row `7001` on menu `6000`. `readExistingEntity('npc', 1423)` must give `gossipMenu.menus` `[5000, 5001]` with menu 5000 locked (NPC 68 uses it) and menu 5001 locked (an object uses it, and its text 7001 is used by menu 6000); an NPC alone with its menu has both unlocked.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/gossip-services.test.ts tests/core/entities-gossip-read.test.ts tests/main/api-existing.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block and behavior paragraph. Add `sharedMenus`/`sharedTexts` as optional (default `{}`) so older callers need no change.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core tests/main && npm run typecheck` — Expected: PASS (update any older test that does `toEqual` on a whole NPC or origin to include `gossipMenu: null`).
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): NPCs carry a gossip menu tree read from the gossip tables"
```

---

### Task 2: Writing an existing NPC's gossip

**Files:**
- Modify: `src/core/entities/existing.ts` (`npcStatements`, a `writeGossip` helper, `gossip_menu_id` in the derived list passed to `keepUnedited`)
- Test: `tests/core/entities-gossip-existing.test.ts` (create), extend `tests/main/api-existing-export.test.ts`

**Interfaces:**
- Consumes: `CustomNpc.gossipMenu`, `sameGossip`, `gossipUnread`, `GossipMenu` (Task 1); `writeTable`, `keepUnedited`, `rowsOf` (existing).
- Produces: `existingStatements(...)` writes, for an existing NPC whose gossip tree differs from what was read (not unread): per unlocked menu that is new, changed or removed: `gossip_menu`, `npc_text`, `gossip_menu_option` statements (in that table order); and `creature_template.gossip_menu_id`.

Behavior:
- `asRead = npcFromRows(...)` (already computed). `treeChanged = !gossipUnread(npc) && !sameGossip(npc.gossipMenu, asRead.gossipMenu)`. If not `treeChanged`, nothing is written and `gossip_menu_id` is left as the row has it.
- Menus are matched by `menuId`. For each held menu `M` with read counterpart `R`: skip when `M.locked`; skip when `R` exists and `sameMenu(M, R)` (all fields but `locked`). For each read menu `R` that is unlocked and not held: it is removed.
- Keys per written menu: `gossip_menu` `{MenuID, TextID}` for `M.textId` and, when `R` exists, `R.textId`; `gossip_menu_option` `{MenuID, OptionID}` for every option id in `M` and in `R`; `npc_text` `{ID}` for `M.textId` and, when `R` exists, `R.textId` (a removed menu: its own text). A menu with `textId 0` writes no text or menu-text rows. Keys deduplicated.
- Rows: `gossip_menu`: `{ ...originalRow(MenuID, TextID) , MenuID, TextID }`. `npc_text`: `{ ...originalTextRow, ID }` with, for each variant `i < greeting.length`: `text{i}_0`, `text{i}_1`, `Probability{i}` from the variant (text columns written as given; an empty female text as `''`), and `BroadcastTextID{i}` kept from the original row when that variant is unchanged (compare `text`, `textFemale`, `probability` with the read menu's variant `i`), else `'0'`; for `i >= greeting.length` and `i < 8`: the original row's columns kept as they are when the variant was never read as used, else `text{i}_0` and `text{i}_1` set to `''`, `Probability{i}` `'0'`, `BroadcastTextID{i}` `'0'`. A text column whose original value is NULL stays NULL when the new value is `''`. `gossip_menu_option`: for each option, the original row of the same key (if any) overlaid with `OptionIcon`, `OptionText`, `OptionType`, `OptionNpcFlag`, `ActionMenuID`; an option equal to the one read (all modelled fields) is written as its original row unchanged; an edited text clears `OptionBroadcastTextID` to `'0'`; the action columns are `close` → type 1, flag 1, `ActionMenuID` 0; `menu` → `ActionMenuID` the menu id, type and flag from the original row when its action was `menu` or `close`, else 1 and 1; `service` → its type and flag, `ActionMenuID` 0. A new option has only these columns (the generic defaults step in `patches.ts` fills the rest).
- A read `kept` option missing from a held menu is NOT deleted by the writer: it is kept as read (validation, Task 4, is the gate that stops the export).
- `creature_template`: `gossip_menu_id` is the root menu's `menuId` (`'0'` when `gossipMenu` is null), written only when the root id differs from the one read or one of them is absent; `gossip_menu_id` is added to the derived columns of `keepUnedited`. Bit 1 of `npcflag` stays driven by the NPC's `gossip` flag only.
- A locked root menu with `gossipMenu` null (the link is removed) writes only `gossip_menu_id = '0'`; nothing is deleted.
- Revert: the existing `writeTable` revert restores the original rows of every key written and deletes new ones.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-gossip-existing.test.ts
import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, type CustomNpc, type GossipMenu } from '../../src/core/entities/model';

const template = { entry: '1423', name: 'Guard', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '129', lootid: '0', AIName: '', ScriptName: '', gossip_menu_id: '5000' };
const model = { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const menuRow = (id: string, text: string) => ({ MenuID: id, TextID: text, VerifiedBuild: '12340' });
const textRow = (id: string, over: Record<string, string | null> = {}) => ({ ID: id, text0_0: 'Hello', text0_1: 'Hello, lady', BroadcastTextID0: '123', lang0: '0', Probability0: '1', text1_0: '', text1_1: '', BroadcastTextID1: '0', Probability1: '0', VerifiedBuild: '12340', ...over });
const optionRow = (menuId: string, id: string, over: Record<string, string | null> = {}) => ({ MenuID: menuId, OptionID: id, OptionIcon: '0', OptionText: 'Option', OptionBroadcastTextID: '77', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0', ActionPoiID: '0', BoxCoded: '0', BoxMoney: '0', BoxText: null, BoxBroadcastTextID: '0', VerifiedBuild: '12340', ...over });
const gossipRows = {
  creature_template: [template], creature_template_model: [model],
  gossip_menu: [menuRow('5000', '7000'), menuRow('5001', '7001')],
  npc_text: [textRow('7000'), textRow('7001', { text0_0: 'Farewell', text0_1: '', BroadcastTextID0: '0' })],
  gossip_menu_option: [
    optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128' }),
    optionRow('5000', '1', { OptionText: 'More', ActionMenuID: '5001' }),
    optionRow('5001', '0', { OptionText: 'Bye' }),
  ],
  conditions: [], smart_scripts: [],
};
const bare = { creature_template: [{ ...template, gossip_menu_id: '0' }], creature_template_model: [model], gossip_menu: [], npc_text: [], gossip_menu_option: [], conditions: [], smart_scripts: [] };
const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const store = (npc: CustomNpc) => ({ ...EMPTY_ENTITIES, npcs: [npc] });
const TABLES = ['gossip_menu', 'gossip_menu_option', 'npc_text'];
const gossipStatements = (npc: CustomNpc) => {
  const out = existingStatements(store(npc), []);
  const only = (list: typeof out.apply) => list.filter((s) => TABLES.includes(s.table));
  return { apply: only(out.apply), revert: only(out.revert) };
};
const templateRowOf = (npc: CustomNpc) => (existingStatements(store(npc), []).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> }).row;
const read = (rows: object = gossipRows, c = counts) => npcFromRows(1423, rows as never, c);
/** The NPC with one menu replaced */
const withMenu = (npc: CustomNpc, index: number, change: (m: GossipMenu) => GossipMenu): CustomNpc =>
  ({ ...npc, gossipMenu: { menus: npc.gossipMenu!.menus.map((m, i) => (i === index ? change(m) : m)) } });

describe('writing an existing NPC\'s gossip', () => {
  it('writes nothing for a tree it only read, and leaves gossip_menu_id and npcflag as they were', () => {
    const npc = read();
    expect(gossipStatements(npc)).toEqual({ apply: [], revert: [] });
    expect(templateRowOf(npc)).toMatchObject({ gossip_menu_id: '5000', npcflag: '129' });
  });

  it('writes only the menu that changed, keyed option by option, keeping other options untouched and clearing the edited text\'s broadcast id', () => {
    const edited = withMenu(read(), 0, (m) => ({ ...m, options: m.options.map((o) => (o.optionId === 1 ? { ...o, text: 'Tell me more' } : o)) }));
    const { apply, revert } = gossipStatements(edited);
    expect(apply).toEqual([
      { kind: 'delete', table: 'gossip_menu', key: { MenuID: '5000', TextID: '7000' } },
      { kind: 'insert', table: 'gossip_menu', row: menuRow('5000', '7000') },
      { kind: 'delete', table: 'npc_text', key: { ID: '7000' } },
      { kind: 'insert', table: 'npc_text', row: textRow('7000') },
      { kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5000', OptionID: '0' } },
      { kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5000', OptionID: '1' } },
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128' }) },
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '1', { OptionText: 'Tell me more', OptionBroadcastTextID: '0', ActionMenuID: '5001' }) },
    ]);
    expect(revert.filter((s) => s.kind === 'insert')).toEqual([
      { kind: 'insert', table: 'gossip_menu', row: menuRow('5000', '7000') },
      { kind: 'insert', table: 'npc_text', row: textRow('7000') },
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128' }) },
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '1', { OptionText: 'More', ActionMenuID: '5001' }) },
    ]);
    expect(templateRowOf(edited)).toMatchObject({ gossip_menu_id: '5000', npcflag: '129' });
  });

  it('clears a variant\'s broadcast id only when its text changed', () => {
    const same = withMenu(read(), 0, (m) => ({ ...m, options: [...m.options, { optionId: 2, icon: 0, text: 'New', action: { kind: 'close' }, kept: false }] }));
    expect(gossipStatements(same).apply).toContainEqual({ kind: 'insert', table: 'npc_text', row: textRow('7000') });
    const changed = withMenu(read(), 0, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Welcome' }] }));
    expect(gossipStatements(changed).apply).toContainEqual({ kind: 'insert', table: 'npc_text', row: textRow('7000', { text0_0: 'Welcome', BroadcastTextID0: '0' }) });
  });

  it('adds a new option with the next id and a close action as type 1, flag 1', () => {
    const added = withMenu(read(), 1, (m) => ({ ...m, options: [...m.options, { optionId: 1, icon: 3, text: 'Farewell', action: { kind: 'close' }, kept: false }] }));
    const inserted = gossipStatements(added).apply.find((s) => s.table === 'gossip_menu_option' && s.kind === 'insert' && s.row.OptionID === '1');
    expect(inserted).toEqual({ kind: 'insert', table: 'gossip_menu_option', row: { MenuID: '5001', OptionID: '1', OptionIcon: '3', OptionText: 'Farewell', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' } });
  });

  it('writes a service option as its type and flag, and a changed action as the type and flag of its new kind', () => {
    const service = withMenu(read(), 0, (m) => ({ ...m, options: m.options.map((o) => (o.optionId === 1 ? { ...o, action: { kind: 'service' as const, type: 5, npcFlag: 16 } } : o)) }));
    expect(gossipStatements(service).apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '1', { OptionText: 'More', OptionType: '5', OptionNpcFlag: '16', ActionMenuID: '0' }) });
    const closed = withMenu(read(), 0, (m) => ({ ...m, options: m.options.map((o) => (o.optionId === 0 ? { ...o, action: { kind: 'close' as const } } : o)) }));
    expect(gossipStatements(closed).apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' }) });
  });

  it('keeps the type and flag of a plain option that opens a menu', () => {
    const odd = { ...gossipRows, gossip_menu_option: [optionRow('5000', '0', { OptionText: 'More', OptionNpcFlag: '3', ActionMenuID: '5001' }), optionRow('5001', '0')] };
    const edited = withMenu(read(odd), 0, (m) => ({ ...m, options: [{ ...m.options[0]!, text: 'Even more' }] }));
    expect(gossipStatements(edited).apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Even more', OptionBroadcastTextID: '0', OptionNpcFlag: '3', ActionMenuID: '5001' }) });
  });

  it('removes a removed option and a removed menu with its text, deleting only keys it owns', () => {
    const noOption = withMenu(read(), 1, (m) => ({ ...m, options: [] }));
    expect(gossipStatements(noOption).apply.filter((s) => s.table === 'gossip_menu_option')).toEqual([{ kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5001', OptionID: '0' } }]);
    const npc = read();
    const dropped = { ...npc, gossipMenu: { menus: [{ ...npc.gossipMenu!.menus[0]!, options: npc.gossipMenu!.menus[0]!.options.filter((o) => o.optionId === 0) }] } };
    const { apply } = gossipStatements(dropped);
    expect(apply).toContainEqual({ kind: 'delete', table: 'gossip_menu', key: { MenuID: '5001', TextID: '7001' } });
    expect(apply).toContainEqual({ kind: 'delete', table: 'npc_text', key: { ID: '7001' } });
    expect(apply).toContainEqual({ kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5001', OptionID: '0' } });
    expect(apply.filter((s) => s.kind === 'insert' && s.table === 'gossip_menu' && s.row.MenuID === '5001')).toEqual([]);
  });

  it('never writes a locked menu, and never deletes a kept option', () => {
    const shared = read(gossipRows, { ...counts, sharedMenus: { 5000: 2 } });
    const edited = withMenu(shared, 0, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Changed' }] }));
    expect(gossipStatements(edited)).toEqual({ apply: [], revert: [] });
    const tied = read({ ...gossipRows, conditions: [{ SourceTypeOrReferenceId: '15', SourceGroup: '5001', SourceEntry: '0' }] });
    const dropped = withMenu(tied, 1, (m) => ({ ...m, options: [] }));
    expect(gossipStatements(dropped).apply.filter((s) => s.table === 'gossip_menu_option')).toEqual([]);
  });

  it('lets an NPC give up a shared root menu by clearing only gossip_menu_id', () => {
    const shared = read(gossipRows, { ...counts, sharedMenus: { 5000: 2 } });
    const out = { ...shared, gossipMenu: null };
    expect(gossipStatements(out)).toEqual({ apply: [], revert: [] });
    expect(templateRowOf(out)).toMatchObject({ gossip_menu_id: '0' });
  });

  it('gives an NPC without a menu one: new rows and gossip_menu_id, other flags kept', () => {
    const npc = read(bare);
    const made = { ...npc, gossipMenu: { menus: [{ menuId: 932535, textId: 9780013, locked: false, greeting: [{ text: 'Hail', textFemale: '', probability: 1 }], options: [{ optionId: 0, icon: 0, text: 'Goodbye', action: { kind: 'close' as const }, kept: false }] }] } };
    const { apply, revert } = gossipStatements(made);
    expect(apply).toEqual([
      { kind: 'delete', table: 'gossip_menu', key: { MenuID: '932535', TextID: '9780013' } },
      { kind: 'insert', table: 'gossip_menu', row: { MenuID: '932535', TextID: '9780013' } },
      { kind: 'delete', table: 'npc_text', key: { ID: '9780013' } },
      { kind: 'insert', table: 'npc_text', row: { ID: '9780013', text0_0: 'Hail', text0_1: '', Probability0: '1', BroadcastTextID0: '0' } },
      { kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '932535', OptionID: '0' } },
      { kind: 'insert', table: 'gossip_menu_option', row: { MenuID: '932535', OptionID: '0', OptionIcon: '0', OptionText: 'Goodbye', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' } },
    ]);
    expect(revert.every((s) => s.kind === 'delete')).toBe(true);
    expect(templateRowOf(made)).toMatchObject({ gossip_menu_id: '932535', npcflag: '129' });
  });

  it('writes a copy under new ids and leaves the shared menu\'s rows in no key', () => {
    const shared = read(gossipRows, { ...counts, sharedMenus: { 5000: 2, 5001: 2 } });
    const m0 = shared.gossipMenu!.menus[0]!;
    const m1 = shared.gossipMenu!.menus[1]!;
    const copy: CustomNpc = {
      ...shared,
      gossipMenu: { menus: [
        { ...m0, menuId: 932535, textId: 9780013, locked: false, options: m0.options.map((o) => (o.action.kind === 'menu' ? { ...o, action: { kind: 'menu' as const, menuId: 932536 } } : o)) },
        { ...m1, menuId: 932536, textId: 9780014, locked: false },
      ] },
    };
    const { apply, revert } = gossipStatements(copy);
    for (const s of [...apply, ...revert]) {
      const key = s.kind === 'insert' ? s.row : s.key;
      if (s.table === 'gossip_menu' || s.table === 'gossip_menu_option') expect(['5000', '5001']).not.toContain(key.MenuID);
      if (s.table === 'npc_text') expect(['7000', '7001']).not.toContain(key.ID);
    }
    expect(apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('932535', '1', { OptionText: 'More', ActionMenuID: '932536' }) });
    expect(templateRowOf(copy)).toMatchObject({ gossip_menu_id: '932535' });
  });

  it('keeps a text column the database left NULL as NULL', () => {
    const nulled = read({ ...gossipRows, npc_text: [textRow('7000', { text0_1: null }), textRow('7001')] });
    const edited = withMenu(nulled, 0, (m) => ({ ...m, options: [] }));
    expect(gossipStatements(edited).apply).toContainEqual({ kind: 'insert', table: 'npc_text', row: textRow('7000', { text0_1: null }) });
  });

  it('never touches gossip it did not read (a project saved before gossip, or a fork without the tables)', () => {
    const { gossip_menu: _a, gossip_menu_option: _b, npc_text: _c, ...unread } = gossipRows;
    const npc = read(unread);
    const edited = { ...npc, gossipMenu: { menus: [{ menuId: 932535, textId: 9780013, locked: false, greeting: [{ text: 'Hail', textFemale: '', probability: 1 }], options: [] }] } };
    expect(gossipStatements(edited)).toEqual({ apply: [], revert: [] });
    expect(templateRowOf(edited)).toMatchObject({ gossip_menu_id: '5000' });
  });
});
```

Add to `tests/main/api-existing-export.test.ts` (its `setup()` builds NPC 1423): three export tests that call `exportProject()` and assert the rendered SQL, each against the fake DB's real `gossip_menu`/`gossip_menu_option`/`npc_text` columns: (1) an NPC with no menu given one (`INSERT INTO \`gossip_menu\` ... VALUES (932535, 9780013, ...)`, `INSERT INTO \`npc_text\``, `INSERT INTO \`gossip_menu_option\``, and `gossip_menu_id` 932535 in the `creature_template` insert); (2) an option added to the NPC's own menu; (3) a shared root menu's NPC given its own copy, with no statement naming the shared ids. Each asserts `out.ok` (print `out.error` in the assertion message).

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/entities-gossip-existing.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the behavior above in `npcStatements` and a `writeGossip` helper.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core/entities-gossip-existing.test.ts tests/core/entities-existing.test.ts tests/core/entities-trainer-existing.test.ts tests/core/entities-vendor-existing.test.ts tests/main/api-existing-export.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): export an existing NPC's edited gossip menus"
```

---

### Task 3: Compiling a new NPC's gossip

**Files:**
- Modify: `src/core/entities/compile.ts`, `src/core/entities/context.ts`, `src/core/scripts/statements.ts`, `src/main/api/export-api.ts`
- Test: `tests/core/entities-gossip-compile.test.ts` (create), extend `tests/main` for the quest preview

**Interfaces:**
- Consumes: `CustomNpc.gossipMenu` (Task 1).
- Produces: `compileEntities(...)`: for each new NPC with a tree: `inserts.gossip_menu` `{ MenuID, TextID }`, `inserts.npc_text` `{ ID, text{i}_0, text{i}_1, Probability{i} }` per variant, `inserts.gossip_menu_option` `{ MenuID, OptionID, OptionIcon, OptionText, OptionType, OptionNpcFlag, ActionMenuID }` (strings), and the NPC's `creature_template` row gets `gossip_menu_id` of the root (otherwise the context row's value, as today); locked menus are never compiled.
- Produces: `EntityContext` gains `gossipOptions: RawRow[]` (`MenuID`, `OptionID` of every option the database holds for the menus the new NPCs hold or whose entries' `gossip_menu_id` names), `gossipUsers: RawRow[]` (`MenuID`, `Entry` of every creature whose `gossip_menu_id` is one of those menus) and `gossipScripted: RawRow[]` (`event_param1`, `event_param2` of the gossip-select scripts naming them); `EMPTY_ENTITY_CONTEXT` has `[]` for each.
- Deletes (new NPCs only): `gossip_menu` by `{ MenuID, TextID }`, `gossip_menu_option` by `{ MenuID, OptionID }`, `npc_text` by `{ ID }`, for (a) every menu/text/option the NPC holds, and (b) every option the database holds (`gossipOptions`) for a menu that only project NPCs use (`gossipUsers`: every user entry is a project NPC entry, and no gameobject uses it) and that no gossip-select script names (`gossipScripted`), together with the `gossip_menu`/`npc_text` rows of such a menu that the NPC no longer holds. A menu a creature outside the project uses is never deleted from.

Ordering: gossip statements delete options before menu rows before `npc_text`, and `creature_template` insert before `gossip_menu`, `npc_text`, `gossip_menu_option` inserts. The three gossip tables are in `SCRIPT_TABLES` already and stay out of `ENTITY_TABLES` (the quest preview treats them as script tables); `ENTITY_KEYS` gains `gossip_menu: ['MenuID','TextID']`, `gossip_menu_option: ['MenuID','OptionID']`, `npc_text: ['ID']`. The quest preview (`previewChanges`) must list an NPC's gossip rows as added/changed against the database, and not report the scene compiler's gossip rows twice.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-gossip-compile.test.ts
import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT, ENTITY_KEYS } from '../../src/core/entities/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import { loadSchema } from '../../src/core/schema/load';
import { newNpc, newSpawn, type CustomNpc, type GossipMenu } from '../../src/core/entities/model';
import { FakeWorldDb } from '../helpers/fake-world-db';

const root: GossipMenu = {
  menuId: 932535, textId: 9780013, locked: false,
  greeting: [{ text: 'Hail', textFemale: 'Hail, lady', probability: 1 }, { text: 'Well met', textFemale: '', probability: 0.5 }],
  options: [
    { optionId: 0, icon: 1, text: 'Browse', action: { kind: 'service', type: 3, npcFlag: 128 }, kept: false },
    { optionId: 1, icon: 0, text: 'More', action: { kind: 'menu', menuId: 932536 }, kept: false },
  ],
};
const sub: GossipMenu = { menuId: 932536, textId: 9780014, locked: false, greeting: [{ text: 'Farewell', textFemale: '', probability: 1 }], options: [{ optionId: 0, icon: 0, text: 'Bye', action: { kind: 'close' }, kept: false }] };
const host: CustomNpc = { ...newNpc(12000001), name: 'Hela', displayId: 1, gossip: true, spawns: [{ ...newSpawn(6000001) }], gossipMenu: { menus: [root, sub] } };
const plain: CustomNpc = { ...newNpc(12000002), name: 'Idle', displayId: 1 };
const compile = (npcs: CustomNpc[], context = EMPTY_ENTITY_CONTEXT) => compileEntities({ entities: { npcs, objects: [], items: [] }, givers: [], context });

describe('compiling a new NPC\'s gossip', () => {
  it('writes each menu, its text variants and its options, with the root as the NPC\'s gossip_menu_id', () => {
    const out = compile([host]);
    expect(out.inserts.gossip_menu).toEqual([{ MenuID: '932535', TextID: '9780013' }, { MenuID: '932536', TextID: '9780014' }]);
    expect(out.inserts.npc_text).toEqual([
      { ID: '9780013', text0_0: 'Hail', text0_1: 'Hail, lady', Probability0: '1', text1_0: 'Well met', text1_1: '', Probability1: '0.5' },
      { ID: '9780014', text0_0: 'Farewell', text0_1: '', Probability0: '1' },
    ]);
    expect(out.inserts.gossip_menu_option).toEqual([
      { MenuID: '932535', OptionID: '0', OptionIcon: '1', OptionText: 'Browse', OptionType: '3', OptionNpcFlag: '128', ActionMenuID: '0' },
      { MenuID: '932535', OptionID: '1', OptionIcon: '0', OptionText: 'More', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '932536' },
      { MenuID: '932536', OptionID: '0', OptionIcon: '0', OptionText: 'Bye', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' },
    ]);
    expect(out.inserts.creature_template![0]).toMatchObject({ gossip_menu_id: '932535', npcflag: '1' });
    expect(compile([plain]).inserts.creature_template![0]).toMatchObject({ gossip_menu_id: '0' });
  });

  it('leaves a locked menu out', () => {
    const out = compile([{ ...host, gossipMenu: { menus: [{ ...root, locked: true }, sub] } }]);
    expect(out.inserts.gossip_menu).toEqual([{ MenuID: '932536', TextID: '9780014' }]);
  });

  it('deletes what the NPC holds by key so a removed option, menu or variant is cleaned on re-export', () => {
    const out = compile([host]);
    expect(out.deletes.gossip_menu_option).toEqual([{ MenuID: '932535', OptionID: '0' }, { MenuID: '932535', OptionID: '1' }, { MenuID: '932536', OptionID: '0' }]);
    expect(out.deletes.gossip_menu).toEqual([{ MenuID: '932535', TextID: '9780013' }, { MenuID: '932536', TextID: '9780014' }]);
    expect(out.deletes.npc_text).toEqual([{ ID: '9780013' }, { ID: '9780014' }]);
  });

  it('also deletes options and menus a past export wrote that it no longer holds, but only on menus no one else uses', () => {
    const context = {
      ...EMPTY_ENTITY_CONTEXT,
      gossipOptions: [{ MenuID: '932535', OptionID: '5' }, { MenuID: '777', OptionID: '0' }, { MenuID: '932535', OptionID: '6' }],
      gossipUsers: [{ MenuID: '932535', Entry: '12000001' }, { MenuID: '777', Entry: '12000001' }, { MenuID: '777', Entry: '555' }],
      gossipScripted: [{ event_param1: '932535', event_param2: '6' }],
    };
    const out = compile([host], context);
    expect(out.deletes.gossip_menu_option).toContainEqual({ MenuID: '932535', OptionID: '5' });
    // a quest scene's scripted option stays
    expect(out.deletes.gossip_menu_option).not.toContainEqual({ MenuID: '932535', OptionID: '6' });
    // menu 777 is a creature outside the project's too
    expect(out.deletes.gossip_menu_option).not.toContainEqual({ MenuID: '777', OptionID: '0' });
  });

  it('removes the menu of an NPC that no longer has one, and never one NPCs outside the project use', () => {
    const context = {
      ...EMPTY_ENTITY_CONTEXT,
      gossipOptions: [{ MenuID: '932535', OptionID: '0' }, { MenuID: '777', OptionID: '0' }],
      gossipUsers: [{ MenuID: '932535', Entry: '12000001' }, { MenuID: '777', Entry: '12000001' }, { MenuID: '777', Entry: '555' }],
    };
    const out = compile([{ ...host, gossipMenu: null }], context);
    expect(out.deletes.gossip_menu_option).toEqual([{ MenuID: '932535', OptionID: '0' }]);
  });

  it('is keyed correctly and ordered: options deleted before menus, inserted after the template', async () => {
    expect(ENTITY_KEYS.gossip_menu).toEqual(['MenuID', 'TextID']);
    expect(ENTITY_KEYS.gossip_menu_option).toEqual(['MenuID', 'OptionID']);
    expect(ENTITY_KEYS.npc_text).toEqual(['ID']);
    const tables = ['creature_template', 'creature_template_model', 'gossip_menu', 'gossip_menu_option', 'npc_text'];
    const schema = await loadSchema(FakeWorldDb.fromFork(tables), tables);
    const { statements } = scriptStatements(compile([host]), schema);
    const at = (kind: string, table: string) => statements.findIndex((s) => s.kind === kind && s.table === table);
    expect(at('delete', 'gossip_menu_option')).toBeLessThan(at('delete', 'gossip_menu'));
    expect(at('insert', 'creature_template')).toBeLessThan(at('insert', 'gossip_menu'));
    expect(at('insert', 'gossip_menu')).toBeGreaterThanOrEqual(0);
  });
});
```

Also add a `tests/main` test (extend `tests/main/api-existing-export.test.ts` or the file that tests `previewChanges`) with a project holding a new NPC with a gossip tree: `previewChanges` lists its `gossip_menu`, `gossip_menu_option` and `npc_text` rows as added, once each, and a quest scene with a gossip trigger on another NPC still lists its own rows once.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/entities-gossip-compile.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block; `readEntityContext` reads the three new lists with `rowsOrNone` (menu ids: the trees' `menuId`s and each new entry's current `creature_template.gossip_menu_id`; users from `creature_template.gossip_menu_id` plus `gameobject_template` type 2 `Data3` shown as `Entry: '-1'` so they are never project entries; scripts from `smart_scripts` `source_type` 0, `event_type` 62).
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core tests/main` — Expected: PASS (older tests that enumerate every `deletes` key or `EMPTY_ENTITY_CONTEXT` literals are updated for the new keys).
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): compile a new NPC's gossip"
```

---

### Task 4: Validation

**Files:**
- Modify: `src/core/entities/validate.ts`, `src/main/api/checks.ts`
- Test: `tests/core/entities-gossip-validate.test.ts` (create), extend `tests/main/api-authoring.test.ts`

**Interfaces:**
- Produces: `entityIssues` input gains
  - `gossipFacts?: GossipFacts | null` with `interface GossipFacts { menuRows: ReadonlySet<number>; menuUsers: ReadonlyMap<number, { creatures: readonly number[]; objects: number }>; textMenus: ReadonlyMap<number, readonly number[]>; knownMenu: (id: number) => boolean }` — `menuRows` the ids with any `gossip_menu` or `gossip_menu_option` row, `menuUsers` who uses each id now, `textMenus` which menus use each text id, `knownMenu` whether the database has the menu id (for `GOSSIP_UNKNOWN_MENU`); null skips the checks that need it.
  - `sceneGossipOwners?: ReadonlySet<number>`: creature entries a quest scene with a gossip option trigger belongs to (for `GOSSIP_SCENE`).
  Export `type GossipFacts`.
- Codes (all `fieldId: ENTITIES_FIELD`, prefixed by the entity label):
  - errors: `GOSSIP_KEPT_REMOVED` ("an option the database ties to a condition or a script is no longer there"), `GOSSIP_NO_ID` (`menuId <= 0` or `textId <= 0`), `GOSSIP_OPTION_NO_TEXT`, `GOSSIP_NO_GREETING` (every variant has probability 0), `GOSSIP_ID_TAKEN` (a new menu or text id another NPC or menu in the database uses), `GOSSIP_ID_DUPLICATE` (two project NPCs hold the same new menu or text id), `GOSSIP_SHARED` (an edit would be written over a menu others use now);
  - warnings: `GOSSIP_EMPTY_GREETING` (a variant with no text), `GOSSIP_UNKNOWN_MENU` (an option opens a menu neither in the NPC's tree nor in the database), `GOSSIP_UNREACHABLE` (a menu no option reaches from the root), `GOSSIP_SERVICE_FLAG` (a service option whose `npcFlag` bits the NPC's flags lack: a vendor option on a non-vendor; the NPC's flags are read from `origin.original.creature_template[0].npcflag` for an existing NPC, and from `gossip`/`questGiver`/`vendor.length > 0`/`trainer !== null` for any NPC with the bits 1, 2, 128, 16), `GOSSIP_SCENE`, `GOSSIP_LOCKED` (an edit to a locked menu), `GOSSIP_NOT_TALKABLE` (a menu but `gossip` is false), `GOSSIP_NOT_READ`.
- Rules, in order: an NPC with a tree and `gossipUnread` → only `GOSSIP_NOT_READ`. For existing NPCs, a menu left as read is not checked; a locked menu whose content changed → `GOSSIP_LOCKED` only; a menu whose id equals a read id and which is unlocked and changed → `GOSSIP_SHARED` when `menuUsers` shows another creature or any object using it. Ids new to the project (a menu or text id not read) are checked: taken when `menuRows` has the id (or `textMenus` names a menu outside the NPC's own tree for a text id) unless this NPC is its only user; duplicate when another project NPC holds the same new id. `GOSSIP_KEPT_REMOVED`: a read menu with a `kept` option, or a read `kept` option, absent from the held tree (compare against the tree read from `origin.original`). Service flag, unreachable and the rest run on changed trees.

- [ ] **Step 1: Write the failing tests** (`tests/core/entities-gossip-validate.test.ts`, same style as `entities-trainer-validate.test.ts`): helper builders `menu(over)`, `npc(tree, base)`, `check(npcs, over)`, `codes(list)`; cases: a clean tree gives `[]`; each error and warning above in isolation with the exact code list expected (including `GOSSIP_NO_GREETING` for probabilities `[0]`, `GOSSIP_EMPTY_GREETING` for a blank variant, `GOSSIP_UNREACHABLE` for a second menu no option opens, `GOSSIP_UNKNOWN_MENU` with `knownMenu: () => false` and silent with `gossipFacts: null`, `GOSSIP_SERVICE_FLAG` for a vendor option on a plain NPC and silent when `vendor` has an item or the original `npcflag` has 128, `GOSSIP_NOT_TALKABLE`, `GOSSIP_SCENE` via `sceneGossipOwners`); id ownership: taken by another creature, free for the NPC's own re-export (`menuUsers` only itself, `menuRows` has it), duplicate across two NPCs, text taken via `textMenus`; the shared/locked rules built from `npcFromRows` fixtures exactly as the trainer tests do (`read(sharedMenus)`); unchanged existing tree with quirks (a blank option text) gives `[]`; unread gives only `GOSSIP_NOT_READ`; `GOSSIP_KEPT_REMOVED` when a read kept option is dropped. Extend `tests/main/api-authoring.test.ts`: project NPCs whose menu ids are taken by another creature (error), re-exported by themselves (no issue), duplicated (errors), and an existing NPC's unlocked edited menu that another NPC now uses (`GOSSIP_SHARED`), through `api.projectIssues()`.
- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** the checks and the `checks.ts` plumbing (one query per fact: `gossip_menu` and `gossip_menu_option` `MenuID` for `menuRows`; `creature_template` `gossip_menu_id`, `gameobject_template` type 2 `Data3` for `menuUsers`; `gossip_menu` `TextID` for `textMenus`; scenes from `readScenes` of every project quest for `sceneGossipOwners`).
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core/entities-gossip-validate.test.ts tests/core/entities-validate.test.ts tests/main` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): validate gossip menus"
```

---

### Task 5: Allocating menu and text ids

**Files:**
- Modify: `src/shared/ipc/entities.ts` (`AllocKind`), `src/shared/ipc/requests.ts`, `src/main/api/entities-api.ts`, `src/main/mcp/tools/entities.ts`, `src/core/db/world-db.ts` (+ `mysql-world-db.ts`, `tests/helpers/fake-world-db.ts`): `selectMax(table, column, below?)`
- Test: `tests/main/api-gossip-alloc.test.ts` (create), extend the MCP tool test that lists `allocate_ids` kinds

**Interfaces:**
- `allocateIds('gossipMenu', n)`: above the highest of `gossip_menu.MenuID`, `gossip_menu_option.MenuID`, `creature_template.gossip_menu_id`, `gameobject_template.Data3` where `type = 2` (use `selectMax` on each; a fork without a table counts 0), and every `menuId` in the project's NPCs.
- `allocateIds('gossipText', n)`: above the highest `npc_text.ID` below 16,000,000 (`selectMax('npc_text', 'ID', 16000000)`), the highest `gossip_menu.TextID` below that, and every `textId` in the project's NPCs.
- `WorldDb.selectMax(table, column, below?)`: the maximum value strictly below `below` when given.

- [ ] **Step 1: Write the failing tests**: ids allocated above the database and the project for both kinds (seed `gossip_menu` `932534`, `gossip_menu_option` `932540`, a `creature_template` with `gossip_menu_id 932550`, an object `Data3 932560`, `npc_text` ids `9780012` and `16777215`, a project NPC holding menu `932570` and text `9780020`: menus start at `932571`, texts at `9780021`); a dangling reference counts (a `creature_template.gossip_menu_id 932600` with no menu rows); `parseRequest('allocateIds', ['gossipMenu', 1]).ok` and `['gossipText', 1]` are true; the MCP tool accepts both kinds; `selectMax` with `below` on the fake and (integration only) the MySQL implementation.
- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/main tests/core && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(main): allocate gossip menu and text ids"
```

---

### Task 6: MCP authoring and docs for the field

**Files:**
- Modify: `src/core/authoring/models.ts` (the `npc` summary gains "what it says"), `guides.ts`, `examples.ts`, `site/src/content/docs/guides/npcs-and-objects.md` ("Talking"), `reference/database-tables.md`, `guides/ai-mcp.md`
- Test: extend `tests/core/authoring-guides.test.ts`

Content: the guide's Fields list gains `gossipMenu` — `null` or `{ menus }`, the first menu the NPC's own; each menu `{ menuId, textId, greeting, options, locked }` with ids from `allocate_ids` kinds `gossipMenu` and `gossipText` (they must be the NPC's own, never an existing or another NPC's); `greeting` variants `{ text, textFemale, probability }` (1 to 8); options `{ optionId, icon, text, action, kept }` with `action` `{ kind: 'close' }`, `{ kind: 'menu', menuId }` or `{ kind: 'service', type, npcFlag }` and the services table (vendor `3`/`128`, flight master `4`/`8192`, trainer `5`/`16`, innkeeper `8`/`65536`, banker `9`/`131072`, petitions `10`/`262144`, tabard `11`/`524288`, battlemaster `12`/`1048576`, auctioneer `13`/`2097152`, stable master `14`/`4194304`, armorer `15`/`4096`, unlearn talents `16`/`16`); a new option's `optionId` is one above the menu's highest; `locked` menus (shared) are not written, ask the author to use Give it its own copy; `kept` options cannot be removed; an NPC needs `gossip: true` to be talked to; a service option needs the NPC to have that service's flag; scripts are not part of this. "What the editor checks" lists every new code. Example: an innkeeper-style root menu with a vendor-style service option and a sub-menu. Stay within the 6000-character guide limit (shorten wording, never drop a code).

- [ ] **Step 1: Write the failing tests** — in `tests/core/authoring-guides.test.ts` add `GOSSIP` to both code-prefix regexes and:

```ts
it('npc guide and example cover gossip and cite its codes', async () => {
  const { examplesOf } = await import('../../src/core/authoring/examples');
  const guide = guideOf('npc');
  for (const word of ['`gossipMenu`', '`menuId`', '`textId`', '`optionId`', '`kept`', '`locked`', 'allocate_ids', '`gossipMenu`', '`GOSSIP_KEPT_REMOVED`', '`GOSSIP_NO_ID`', '`GOSSIP_OPTION_NO_TEXT`', '`GOSSIP_NO_GREETING`', '`GOSSIP_ID_TAKEN`', '`GOSSIP_ID_DUPLICATE`', '`GOSSIP_SHARED`', '`GOSSIP_EMPTY_GREETING`', '`GOSSIP_UNKNOWN_MENU`', '`GOSSIP_UNREACHABLE`', '`GOSSIP_SERVICE_FLAG`', '`GOSSIP_SCENE`', '`GOSSIP_LOCKED`', '`GOSSIP_NOT_TALKABLE`', '`GOSSIP_NOT_READ`']) expect(guide).toContain(word);
  expect(jsonSchemaOf('npc')).toHaveProperty('properties.gossipMenu');
  const example = examplesOf('npc').find((e) => (e.value as { gossipMenu?: unknown }).gossipMenu)!;
  expect((example.value as { gossipMenu: { menus: { menuId: number }[] } }).gossipMenu.menus[0]!.menuId).toBeGreaterThan(1_000_000_000);
  expect(authoringSummary('npc')).toMatch(/says/);
  expect(guide).toMatch(/Give it its own copy/);
});
```

The existing "names every choice a model allows" test also demands `close`, `menu` and `service` appear as whole words in code font in the guide.

- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement** the guide, example (placeholder ids above 2,000,000,000, noted as only the shape), summary and the three docs pages (the site "Talking" section is finished in Task 9 from the final UI wording; write it now from Task 7's labels).
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core/authoring-guides.test.ts tests/core/authoring-models.test.ts tests/main` and `npm --prefix site run build` — Expected: PASS, links valid.
- [ ] **Step 5: Commit**

```bash
git add src site tests
git commit -m "docs: gossip in the NPC guide, example and docs"
```

---

### Task 7: The Gossip tab

**Files:**
- Create: `src/renderer/entities/GossipTab.tsx`, `GossipMenuEditor.tsx`, `CopyGossip.tsx`
- Modify: `src/renderer/entities/npc/NpcEditor.tsx` (tab `gossip` after `trainer`; prop `allocateGossip?(kind: 'gossipMenu' | 'gossipText'): Promise<number | null>`), `src/renderer/entities/EntityEditorHost.tsx` (passes `allocate`), `tests/renderer/npc-editor.test.tsx` (tab lists: `['Basics','Look & gear','Fight','Loot','Vendor','Trainer','Gossip','Placement']`, eight tabs, tab-stop test)
- Test: `tests/renderer/entities-gossip.test.tsx` (create)

**Interfaces:**
- Consumes: `GossipTree`, `GossipMenu`, `GossipOption`, `gossipUnread`, `GOSSIP_SERVICES`, `serviceOf`, `serviceLabel` (Task 1), `EntityField`, `NumberField`, `SelectField`, `TextField` from `scripts/fields`, `useApi`, `useProjectEntities`, `useName`.
- Produces: `GossipTab({ npc, onChange, allocate })`; `GossipMenuEditor({ idPrefix, tree, index, onChange, ... })`; `CopyGossip({ idPrefix, npcEntry, current, allocate, onCopy })`.

Behavior (labels exact):
- Unread (`gossipUnread(npc)`): only "{name}'s gossip was not read when it was added to this project, so it is not edited here. Choose Put back as the database has it, then edit it again, to read it."
- No tree: hint "This NPC has no gossip menu." and **Give this NPC a gossip menu**: allocates a menu id and a text id (`allocate('gossipMenu')`, `allocate('gossipText')`); either null shows `role="alert"` "Could not get free gossip ids." and changes nothing; otherwise sets `gossipMenu = { menus: [{ menuId, textId, greeting: [{ text: '', textFemale: '', probability: 1 }], options: [], locked: false }] }` and sets the NPC's `gossip` flag on. **Copy menu from…** is shown too.
- With a tree: a list of the NPC's menus (buttons, root first, labelled by the first greeting line or "Menu N"), the selected one's editor:
  - **Greeting**: per variant **Text**, **Female text**, **Chance** (number, min 0), **Remove variant** (not on the last), **Add variant** (up to 8).
  - **Options**: per option, heading `Option N`, **Icon** (number), **Text**, **Does** select: **Closes the window**, **Opens menu…**, each service by label, and "Other (type N, flag M)" for a pair it has no name for; for **Opens menu…** a **Menu** select of this NPC's other menus plus **New menu…** (adds a menu with new ids and points the option at it; a failed allocation shows the alert) and a **Menu id** number field for a menu the database has; picking a service sets the icon to the service's icon when the icon is 0. **Remove**, **Up**, **Down** (display order only). A `kept` option shows "Kept as it is: the database ties it to a condition or a script." instead of **Remove** and its **Does** is disabled. A new option is `{ optionId: highest + 1 (0 for the first), icon: 0, text: '', action: { kind: 'close' }, kept: false }`.
  - **Remove menu** on a non-root menu (and repoints nothing: options that opened it stay and are reported by validation); hidden when the menu holds a `kept` option.
- A service option whose NPC lacks the flag shows "This NPC is not a vendor, so this option would never show." with **Make it a vendor** (switches to the Vendor tab through `onTab`); likewise trainer; other services show the text without a button.
- A locked menu (`locked`): read-only list of its greeting and options, "{n} other NPCs or objects use this menu: changing it would change theirs too." (when the count is known; else "Other NPCs use this menu"), **Give it its own copy** (this menu and the ones only it opens that are also locked: allocates fresh menu and text ids for each, copies content, clears `locked`, repoints options that opened a copied menu; a `kept` option is copied as not kept, and a note "Its conditions and scripts stay with the original." is shown before the copy is made, confirmed by `window.confirm`) and **Copy the whole menu tree** (the same for every locked menu). A failed allocation shows the alert and changes nothing.
- **Remove gossip menu** (all trees): confirm when it has options; sets `gossipMenu: null` (allowed while locked).
- **CopyGossip** ("Copy menu from…"): same rules as the trainer's: "That is this NPC.", "That NPC has no gossip menu.", read errors, confirm when replacing; copies the whole source tree with fresh ids for every menu and text (never reusing source ids), all `locked` false, all `kept` false; a project source that was never read is read from the database.
- When the NPC's `gossip` flag is off while it has a tree, the tab shows "Players cannot open this menu until Can be talked to is on." with a **Turn it on** button.

- [ ] **Step 1: Write the failing tests** — `tests/renderer/entities-gossip.test.tsx` in the style of `entities-trainer.test.tsx` (a `Live` wrapper with `allocate` mocked to hand out increasing ids, `tab="gossip"`): empty state creates one menu with a blank greeting and turns `gossip` on; allocation failure alert; edit greeting text and chance; add and remove variants (not the last, at most 8); add option (first id 0, next highest + 1), edit text/icon; change **Does** to a service sets its icon only when the icon was 0, to **Closes the window**, to **Opens menu…** with **New menu…** creating a second menu with new ids; reorder keeps ids; `kept` option has no **Remove** and a disabled **Does**; a service option on an NPC without the flag shows the hint and **Make it a vendor** calls `onTab('vendor')`; locked menu read-only with the count text, **Give it its own copy** repoints and clears the lock (confirm accepted/declined), **Copy the whole menu tree**, and the failed-allocation alert; **Remove gossip menu** works on a locked tree and asks first when it has options; **Copy menu from…** (new ids, nothing locked or kept, not onto itself, not from an NPC with none, replacing asks first, read from the database when the project's source was never read); the unread note; the not-talkable hint and **Turn it on**.
- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/renderer/entities-gossip.test.tsx tests/renderer/npc-editor.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the components, tab and host wiring; reuse `scene-*` classes.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/renderer tests/core && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(renderer): Gossip tab for NPCs"
```

---

### Task 8: Right-click menu

**Files:**
- Modify: `src/core/db/mysql-world-db.ts` (creature view query also selects `t.gossip_menu_id AS gossip_menu_id`), `src/core/db/view-spawns.ts` (`ViewCreature.gossipMenuId?: number`, `toViewCreature`), `tests/helpers/fake-world-db.ts`, `src/renderer/world3d/scene/spawn/SpawnManager.ts` (`SpawnInfo.gossipMenuId?: number`), `src/core/entities/entity.ts` (`NpcSpawn.gossipMenu: { has: boolean; count: number | null }`), `src/renderer/world3d/menu/subject.ts`, `menu/model.ts` (`MenuEditorTab` gains `'gossip'`), `menu/sections/index.ts`
- Create: `src/renderer/world3d/menu/sections/gossip.ts`
- Test: extend `tests/renderer/world3d-menu-sections.test.ts`, `world3d-menu-subject.test.ts`, `world3d-menu-vendor-open.test.tsx`, `tests/core/db/view-spawns.test.ts`, `tests/main/api-view-spawns.test.ts`; update the section-order assertion and the world-group lists that now include **Add gossip menu…**

**Interfaces:**
- `spawnedEntityOf(info, store)` for an NPC: when the project holds it, its gossip was read (`!gossipUnread`) and it is not a locked-with-no-tree case, `gossipMenu = { has: stored.gossipMenu !== null, count: option count over all its menus }`; otherwise `{ has: (info.gossipMenuId ?? 0) > 0, count: null }`.
- Section `gossip` (id `'gossip'`, group `'world'`, NPC spawns only, registered after `trainer`): label **Edit gossip menu…** when `has`, else **Add gossip menu…**; an existing NPC offline gets `disabledReason: NEEDS_DATABASE`; hint `"N options"` (`"1 option"`) when `count` > 0; action `{ kind: 'editEntity', spawn: info, tab: 'gossip' }`.

- [ ] **Step 1: Write the failing tests** in the style of the vendor and trainer sections: label and action per state; hint singular/plural; a stored NPC with a tree counted across its menus; an unopened database NPC read from `npcFlags`-style `gossipMenuId` (`> 0` has a menu); offline needs the database for a database NPC and not for a project one; not on objects; a stored NPC whose gossip was never read, or locked with no tree, falls back to `gossipMenuId`; the tab pass-through (`onEditEntity('creature', 1423, 'gossip')`, with `afterEach(cleanup)` in that file); `toViewCreature` carries `gossipMenuId` only when the column is present; the main view query test shows `gossipMenuId` for a creature whose template has a menu.
- [ ] **Step 2: Run to verify failure** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/renderer tests/core tests/main && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(world): Add gossip menu… and Edit gossip menu… in the right-click menu"
```

---

### Task 9: Real-database check, docs and final verification

**Files:**
- Create: `tests/integration/gossip-read.int.test.ts`
- Modify: `site/src/content/docs/guides/npcs-and-objects.md` ("Talking"), `guides/the-world.md`, `reference/database-tables.md`, `docs/superpowers/specs/2026-10-09-npc-gossip-design.md` (only if the shipped behavior differs)

- [ ] **Step 1: Write the integration test** modelled on `tests/integration/trainer-read.int.test.ts` (same `mysqlUrl()` helper; it needs `ACQC_TEST_MYSQL_URL` pointing at the world database, supplied on the command line for the run, never written to a file). It reads with `readExistingRows` + `npcFromRows` and asserts, with `ctx.skip()` (never a silent pass) when the data lacks a case: (a) an NPC whose menu has options that open other menus reads a tree of more than one menu, every `action: menu` either loaded or beyond the 24-menu cap; (b) a menu used by several creatures reads `locked` and `sharedMenus` equal to the other users; (c) an option with a condition and one with a gossip-select script read `kept`; (d) a service option reads its preset (`serviceOf` finds it) for the vendor and trainer pairs; (e) a **sweep** of the first creature of every distinct `creature_template.gossip_menu_id` (about 3,000): it reads without throwing, `existingStatements` writes no `gossip_menu`, `gossip_menu_option` or `npc_text` statement, and `gossip_menu_id` and `npcflag` are the row's; (f) a copy of a shared tree under fresh ids (`selectMax` plus 1…) renders: every insert statement, completed with `defaultColumnValues`, passes `renderInsert` against the schema loaded from the real database, and no statement key names a read id. Give the sweep a generous timeout.
- [ ] **Step 2: Run it** — `ACQC_TEST_MYSQL_URL=… npx vitest run --config vitest.int.config.ts tests/integration/gossip-read.int.test.ts` — Expected: PASS against `acore_world`, none skipped (if one is skipped, say which and why).
- [ ] **Step 3: Finish the docs** to match the shipped wording: the Gossip tab's labels, the services, shared and kept behavior, the scripts note, the menu items **Add gossip menu…** and **Edit gossip menu…**, the database tables row (`gossip_menu`, `gossip_menu_option`, `npc_text`, and `gossip_menu_id`).
- [ ] **Step 4: Run the whole verification** — `npm run typecheck && npx vitest run`, then `npm --prefix site run build` — Expected: all green, docs links valid.
- [ ] **Step 5: Commit**

```bash
git add tests site docs
git commit -m "docs: NPC gossip; test: reading real gossip menus"
```
