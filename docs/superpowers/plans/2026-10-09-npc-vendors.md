# NPC vendors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author make any NPC (new or existing) a vendor and edit what it sells, including existing stock, from a Vendor tab, the right-click menu and the MCP authoring tools.

**Architecture:** `CustomNpc` gains an ordered `vendor` list. Existing NPCs read their `npc_vendor` rows into it (keeping the rows in `origin.original`) and write them back as delete + insert through the existing `writeTable` machinery, only when the list changed. New NPCs compile the same rows next to their `creature_template` insert. The UI is a new tab built like `LootList`, plus a DBC-backed extended-cost picker (a new search/lookup kind) and a right-click section.

**Tech Stack:** TypeScript, zod, React, Electron (main/renderer), vitest (+ jsdom, testing-library), MySQL world DB behind `WorldDb` (fake `forkDb()` in tests).

**Spec:** `docs/superpowers/specs/2026-10-09-npc-vendors-design.md`

## Global Constraints

- Table `npc_vendor`, keyed by NPC `entry`; columns written: `entry`, `slot`, `item`, `maxcount`, `incrtime`, `ExtendedCost`; `VerifiedBuild` carried over from the original row of the same `(item, ExtendedCost)` pair, never invented.
- `vendor` item shape (zod, in `src/core/entities/model.ts`): `{ item: int, maxCount: int.min(0), restockSecs: int.min(0), extendedCost: int.min(0) }`; field default `[]` so NPCs saved earlier load unchanged.
- Array order is the display order; export writes `slot` as the 0-based array index.
- `maxCount = 0` means unlimited: `restockSecs` is then written as `0`.
- An NPC is a vendor when `vendor.length > 0`; there is no separate flag in the model. Export sets/clears only `npcflag` bit 128 (vendor); every other bit (ammo/food/poison/reagent sub-types, gossip, quest giver as already handled, anything else) is kept as the database has it.
- Opening an existing NPC never changes anything: `npc_vendor` statements are written only when the list differs from what was read.
- Out of scope: `game_event_npc_vendor`, authoring new `ItemExtendedCost` rows, sharing one stock list between NPCs, trainers and scripts.
- No new MCP tool: the field flows through `new_entity`, `entity_template` (not changed), `upsert_entity` via the zod schema.
- Commit messages: conventional style (`feat(core): …`), no attribution lines.
- Run the whole suite (`npm test`) and `npm run typecheck` before each commit that touches shared types; both must pass.

## Review Focus

Failure modes the spec implies that no task's happy-path tests would exercise; each has a test in the owning task.

1. Opening an existing NPC and saving without touching the Vendor tab writes no `npc_vendor` statements and leaves `npcflag` exactly as it was (Task 2).
2. Adding stock and then removing all of it again, on an NPC that had none, ends as "unchanged" (no statements, flag untouched) (Task 2).
3. Clearing all stock of an existing vendor deletes its rows and clears bit 128 but keeps sub-type bits such as 2048 (Task 2).
4. A project saved before vendors existed (its `origin.original` has no `npc_vendor` key) must never delete stock it did not read: the NPC's vendor list is left alone and the tab says so (Tasks 2 and 6).
5. The same `(item, extendedCost)` pair twice would violate the primary key at apply time: it is an error, not a silent drop; an item of `0` is an error; an unknown item is a warning (Task 4).
6. A re-export of a new NPC whose stock was removed must delete the previously exported rows (Task 3).
7. The right-click menu shows "Edit vendor stock…" for a database NPC the project has not opened yet when its `npcflag` already has the vendor bit (Task 8).

---

### Task 1: Model field and reading an existing NPC's stock

**Files:**
- Modify: `src/core/entities/model.ts` (add `vendorItemSchema`, `vendor` on `npcFields`, `newNpc`, exported `VendorItem` type, `VENDOR_BIT` is NOT here)
- Modify: `src/core/entities/from-rows.ts` (`npcFromRows`)
- Modify: `src/core/entities/existing.ts` (`readOriginalRows`, npc branch only)
- Test: `tests/core/entities-vendor-read.test.ts` (create)

**Interfaces:**
- Produces: `vendorItemSchema` (zod), `type VendorItem = { item: number; maxCount: number; restockSecs: number; extendedCost: number }` exported from `model.ts`; `CustomNpc.vendor: VendorItem[]`; `newNpc(entry).vendor === []`.
- Produces: `readOriginalRows(db, 'npc', entry)` result now includes `npc_vendor: Row[]` (all rows for the entry, as the database has them).
- Produces: `npcFromRows` fills `vendor` from `rows.npc_vendor` ordered by numeric `slot` (stable for equal slots), mapping `item`, `maxcount`→`maxCount`, `incrtime`→`restockSecs`, `ExtendedCost`→`extendedCost`; missing table key gives `[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-vendor-read.test.ts
import { describe, expect, it } from 'vitest';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { readOriginalRows } from '../../src/core/entities/existing';
import { newNpc, projectEntitiesSchema, readProjectEntities } from '../../src/core/entities/model';
import { forkDb } from '../helpers/fixtures';

const counts = { sharedLoot: 0, spawnCount: 1 };
const template = { entry: '54', name: 'Innkeeper', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '129', lootid: '0', AIName: '', ScriptName: '' };
const row = (slot: string, item: string, extra: Record<string, string> = {}) =>
  ({ entry: '54', slot, item, maxcount: '0', incrtime: '0', ExtendedCost: '0', VerifiedBuild: '12340', ...extra });

describe('reading an existing NPC\'s vendor stock', () => {
  it('maps npc_vendor rows to the vendor list in slot order', () => {
    const rows = { creature_template: [template], npc_vendor: [row('2', '117', { maxcount: '5', incrtime: '900' }), row('0', '159', { ExtendedCost: '1234' }), row('1', '4540')] };
    const npc = npcFromRows(54, rows, counts);
    expect(npc.vendor).toEqual([
      { item: 159, maxCount: 0, restockSecs: 0, extendedCost: 1234 },
      { item: 4540, maxCount: 0, restockSecs: 0, extendedCost: 0 },
      { item: 117, maxCount: 5, restockSecs: 900, extendedCost: 0 },
    ]);
    expect(npc.origin).toMatchObject({ kind: 'existing', original: rows });
  });

  it('is empty when the NPC has no stock or the table was not read', () => {
    expect(npcFromRows(54, { creature_template: [template], npc_vendor: [] }, counts).vendor).toEqual([]);
    expect(npcFromRows(54, { creature_template: [template] }, counts).vendor).toEqual([]);
  });

  it('a new NPC has no stock, and an NPC saved before vendors existed loads with none', () => {
    expect(newNpc(1).vendor).toEqual([]);
    const { vendor: _dropped, ...old } = newNpc(7);
    const read = readProjectEntities({ npcs: [old], objects: [], items: [] });
    expect(read.npcs[0]!.vendor).toEqual([]);
    expect(projectEntitiesSchema.safeParse({ npcs: [{ ...newNpc(7), vendor: [{ item: 1, maxCount: -1, restockSecs: 0, extendedCost: 0 }] }], objects: [], items: [] }).success).toBe(false);
  });

  it('readOriginalRows reads the NPC\'s npc_vendor rows with its others', async () => {
    const db = forkDb();
    db.insert('creature_template', template);
    db.insert('npc_vendor', row('0', '159'));
    db.insert('npc_vendor', { ...row('0', '999'), entry: '55' });
    const read = await readOriginalRows(db, 'npc', 54);
    expect(read!.npc_vendor).toEqual([row('0', '159')]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/core/entities-vendor-read.test.ts`
Expected: FAIL (`vendor` is undefined / `npc_vendor` missing from the read).

- [ ] **Step 3: Implement**

In `model.ts`: add `vendorItemSchema` exactly as in Global Constraints (`maxCount`, `restockSecs`, `extendedCost` all `int.min(0)`; `item` plain `int`), add `vendor: z.array(vendorItemSchema).default([])` to `npcFields` after `events` with a comment in the style of `loot` ("Added with NPC vendors; the default keeps NPCs saved before then as they were."), set `vendor: []` in `newNpc`, export `type VendorItem`.
In `from-rows.ts`: add a small `vendorOf(rows)` helper next to `lootOf` that sorts a copy of the rows by `numberOf(r.slot)` and maps columns using `numberOf`; call it from `npcFromRows` and set the result as `vendor` (overriding the `newNpc` default).
In `existing.ts` `readOriginalRows` npc branch: read `npc_vendor` with `rowsOrNone(db, 'npc_vendor', { entry: key })` in the same `Promise.all` as models/equip/loot, and include it in the returned object under the key `npc_vendor`. Drift (`existingDrift`) needs no change: it compares every table key present in `origin.original`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/core/entities-vendor-read.test.ts tests/core/entities-from-rows.test.ts tests/core/entities-existing.test.ts tests/core/entities-model.test.ts`
Expected: PASS. If an older test does `toEqual` on a whole new NPC or on the full `readOriginalRows` result, update its expected value to include `vendor: []` / `npc_vendor: []` (that is the intended new shape).

- [ ] **Step 5: Commit**

```bash
git add src/core/entities/model.ts src/core/entities/from-rows.ts src/core/entities/existing.ts tests
git commit -m "feat(core): NPCs carry a vendor list read from npc_vendor"
```

---

### Task 2: Writing an existing NPC's stock

**Files:**
- Modify: `src/core/entities/existing.ts` (`npcStatements`, a new `vendorRows` helper, `VENDOR_BIT`)
- Test: `tests/core/entities-vendor-existing.test.ts` (create)

**Interfaces:**
- Consumes: `CustomNpc.vendor`, `VendorItem`, `npcFromRows` (Task 1), `writeTable`, `keepUnedited`, `rowsOf` (existing, in `existing.ts`).
- Produces: `existingStatements(store, givers, lootIds)` now also yields, for each existing NPC whose vendor list changed from what was read: `delete npc_vendor {entry}` then one insert per stock row, in apply; delete `{entry}` + inserts of the original rows in revert. `npcflag` bit 128 handling as below.

Behavior to implement in `npcStatements`:
- `asRead = npcFromRows(...)` already exists in the function; "changed" means `JSON.stringify(npc.vendor) !== JSON.stringify(asRead.vendor)` (the list is compared in order, field by field).
- "Unread" means `origin.original` has no own key `npc_vendor` (a project saved before vendors existed). Unread: write no `npc_vendor` statements and leave bit 128 as the original row has it, whatever `npc.vendor` holds.
- Flags: `npcflag = (original & ~(GOSSIP | QUEST_GIVER | VENDOR)) | questGiver bit | gossip bit | vendorBit` where `vendorBit` is `original & VENDOR_BIT` when unchanged or unread, else `VENDOR_BIT` if `npc.vendor.length > 0` else `0`. `VENDOR_BIT = 128`.
- Rows when changed: for each item at index `i`, a row `{ ...originalRowForSamePair, entry, slot: String(i), item, maxcount, incrtime, ExtendedCost }` where `originalRowForSamePair` is the first original `npc_vendor` row whose numeric `item` and `ExtendedCost` match (this carries `VerifiedBuild`); with no match the row has only the six written columns. `incrtime` is `'0'` when `maxCount` is 0, else `String(restockSecs)`.
- Call `writeTable(out, origin, 'npc_vendor', [{ entry }], rows)` only when changed and not unread. An empty list still calls it (deletes, inserts nothing).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-vendor-existing.test.ts
import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, type CustomNpc } from '../../src/core/entities/model';

const template = { entry: '54', name: 'Innkeeper', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '2177', lootid: '0', AIName: '', ScriptName: '' };
const row = (slot: string, item: string, extra: Record<string, string> = {}) =>
  ({ entry: '54', slot, item, maxcount: '0', incrtime: '0', ExtendedCost: '0', VerifiedBuild: '12340', ...extra });
const model = { CreatureID: '54', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const stocked = { creature_template: [template], creature_template_model: [model], npc_vendor: [row('0', '159'), row('1', '117', { maxcount: '5', incrtime: '900' })] };
const bare = { creature_template: [{ ...template, npcflag: '2049' }], creature_template_model: [model], npc_vendor: [] };
const counts = { sharedLoot: 0, spawnCount: 1 };
const store = (npc: CustomNpc) => ({ ...EMPTY_ENTITIES, npcs: [npc] });
const vendorStatements = (npc: CustomNpc) => {
  const out = existingStatements(store(npc), []);
  return { apply: out.apply.filter((s) => s.table === 'npc_vendor'), revert: out.revert.filter((s) => s.table === 'npc_vendor'), all: out };
};
const flagOf = (npc: CustomNpc) => {
  const insert = existingStatements(store(npc), []).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> };
  return Number(insert.row.npcflag);
};

describe('writing an existing NPC\'s vendor stock', () => {
  it('writes nothing for stock it only read, and leaves npcflag as it was', () => {
    const npc = npcFromRows(54, stocked, counts);
    expect(vendorStatements(npc).apply).toEqual([]);
    expect(vendorStatements(npc).revert).toEqual([]);
    expect(flagOf(npc)).toBe(2177);
  });

  it('replaces the list: deletes by entry, inserts the rows with slots, and the revert puts the originals back', () => {
    const npc = npcFromRows(54, stocked, counts);
    const edited = { ...npc, vendor: [npc.vendor[1]!, { item: 4540, maxCount: 0, restockSecs: 600, extendedCost: 0 }, npc.vendor[0]!] };
    const { apply, revert } = vendorStatements(edited);
    expect(apply).toEqual([
      { kind: 'delete', table: 'npc_vendor', key: { entry: '54' } },
      { kind: 'insert', table: 'npc_vendor', row: row('0', '117', { maxcount: '5', incrtime: '900' }) },
      { kind: 'insert', table: 'npc_vendor', row: { entry: '54', slot: '1', item: '4540', maxcount: '0', incrtime: '0', ExtendedCost: '0' } },
      { kind: 'insert', table: 'npc_vendor', row: row('2', '159') },
    ]);
    expect(revert).toEqual([
      { kind: 'delete', table: 'npc_vendor', key: { entry: '54' } },
      { kind: 'insert', table: 'npc_vendor', row: row('0', '159') },
      { kind: 'insert', table: 'npc_vendor', row: row('1', '117', { maxcount: '5', incrtime: '900' }) },
    ]);
    expect(flagOf(edited)).toBe(2177);
  });

  it('writes the restock time as 0 for unlimited stock', () => {
    const npc = npcFromRows(54, bare, counts);
    const { apply } = vendorStatements({ ...npc, vendor: [{ item: 5, maxCount: 0, restockSecs: 900, extendedCost: 77 }] });
    expect(apply[1]).toEqual({ kind: 'insert', table: 'npc_vendor', row: { entry: '54', slot: '0', item: '5', maxcount: '0', incrtime: '0', ExtendedCost: '77' } });
  });

  it('sets the vendor bit when stock is added to an NPC without any', () => {
    const npc = npcFromRows(54, bare, counts);
    expect(flagOf({ ...npc, vendor: [{ item: 5, maxCount: 0, restockSecs: 0, extendedCost: 0 }] })).toBe(2049 | 128);
  });

  it('clears only the vendor bit when all stock is removed, keeping sub-type bits', () => {
    const npc = npcFromRows(54, stocked, counts);
    const { apply } = vendorStatements({ ...npc, vendor: [] });
    expect(apply).toEqual([{ kind: 'delete', table: 'npc_vendor', key: { entry: '54' } }]);
    expect(flagOf({ ...npc, vendor: [] })).toBe(2177 & ~128);
  });

  it('treats stock added and removed again as unchanged', () => {
    const npc = npcFromRows(54, bare, counts);
    const back = { ...npc, vendor: [] };
    expect(vendorStatements(back).apply).toEqual([]);
    expect(flagOf(back)).toBe(2049);
  });

  it('never touches stock it did not read (a project saved before vendors existed)', () => {
    const { npc_vendor: _unread, ...unreadRows } = stocked;
    const npc = npcFromRows(54, unreadRows, counts);
    const edited = { ...npc, vendor: [{ item: 5, maxCount: 0, restockSecs: 0, extendedCost: 0 }] };
    expect(vendorStatements(edited).apply).toEqual([]);
    expect(flagOf(edited)).toBe(2177);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/core/entities-vendor-existing.test.ts`
Expected: FAIL (no `npc_vendor` statements are produced; flags unchanged).

- [ ] **Step 3: Implement** the behavior listed above in `npcStatements`, keeping `npcflag` in the `derived` list already passed to `keepUnedited`. Add the `npc_vendor` writeTable call after the equipment block.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/core/entities-vendor-existing.test.ts tests/core/entities-existing.test.ts`
Expected: PASS (the pre-existing "writes an NPC with no edits exactly as the database had it" test still passes).

- [ ] **Step 5: Commit**

```bash
git add src/core/entities/existing.ts tests/core/entities-vendor-existing.test.ts
git commit -m "feat(core): export an existing NPC's edited vendor stock"
```

---

### Task 3: Compiling a new NPC's stock

**Files:**
- Modify: `src/core/entities/compile.ts` (insert rows, vendor bit, delete keys)
- Modify: `src/core/entities/context.ts` (`ENTITY_TABLES`, `ENTITY_KEYS`)
- Modify: `src/core/scripts/statements.ts` (`DELETE_ORDER`, `INSERT_ORDER`)
- Modify: `src/main/api/export-api.ts` (the `entityBefore` table list around line 61)
- Test: `tests/core/entities-vendor-compile.test.ts` (create)

**Interfaces:**
- Consumes: `CustomNpc.vendor` (Task 1).
- Produces: `compileEntities(...)` output: `inserts.npc_vendor` rows `{ entry, slot, item, maxcount, incrtime, ExtendedCost }` (all strings) for each new NPC, in list order; `deletes.npc_vendor = [{ entry }]` for **every** new NPC entry in the store, sorted ascending, so a removed list is cleaned on re-export; `creature_template.npcflag` includes bit 128 when `vendor.length > 0`.

Behavior: `incrtime` is `'0'` for `maxCount` 0. `scriptStatements` deletes `npc_vendor` before `creature_template` (after `creature_loot_template` is fine) and inserts it after `creature_template`. `ENTITY_TABLES` gains `'npc_vendor'`; `ENTITY_KEYS.npc_vendor = ['entry', 'item', 'ExtendedCost']`. In `export-api.ts` add `['npc_vendor', 'entry']` to the list of tables compared against what the database holds now.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-vendor-compile.test.ts
import { describe, expect, it } from 'vitest';
import { compileEntities } from '../../src/core/entities/compile';
import { EMPTY_ENTITY_CONTEXT } from '../../src/core/entities/context';
import { scriptStatements } from '../../src/core/scripts/statements';
import { newNpc, newSpawn, type CustomNpc } from '../../src/core/entities/model';

const seller: CustomNpc = { ...newNpc(12000001), name: 'Hela', displayId: 1234, questGiver: true, gossip: true,
  spawns: [{ ...newSpawn(6000001) }],
  vendor: [{ item: 159, maxCount: 0, restockSecs: 900, extendedCost: 0 }, { item: 4540, maxCount: 5, restockSecs: 900, extendedCost: 1234 }] };
const plain: CustomNpc = { ...newNpc(12000002), name: 'Idle', displayId: 1234 };
const compile = (npcs: CustomNpc[]) => compileEntities({ entities: { npcs, objects: [], items: [] }, givers: [], context: EMPTY_ENTITY_CONTEXT });

describe('compiling a new NPC\'s vendor stock', () => {
  it('writes one npc_vendor row per item, in order', () => {
    expect(compile([seller]).inserts.npc_vendor).toEqual([
      { entry: '12000001', slot: '0', item: '159', maxcount: '0', incrtime: '0', ExtendedCost: '0' },
      { entry: '12000001', slot: '1', item: '4540', maxcount: '5', incrtime: '900', ExtendedCost: '1234' },
    ]);
  });

  it('sets the vendor bit with the quest giver and gossip bits, and not for a non-vendor', () => {
    expect(compile([seller]).inserts.creature_template![0]!.npcflag).toBe(String(1 | 2 | 128));
    expect(compile([plain]).inserts.creature_template![0]!.npcflag).toBe('0');
  });

  it('deletes every new NPC\'s stock by entry so a removed list is cleaned on re-export', () => {
    const out = compile([seller, plain]);
    expect(out.deletes.npc_vendor).toEqual([{ entry: '12000001' }, { entry: '12000002' }]);
    expect(out.inserts.npc_vendor).toHaveLength(2);
  });

  it('orders the statements: stock deleted before its template, inserted after it', () => {
    const { statements } = scriptStatements(compile([seller]), { tables: { creature_template: [], npc_vendor: [] }, forbidden: [], hash: '' } as never);
    const at = (kind: string, table: string) => statements.findIndex((s) => s.kind === kind && s.table === table);
    expect(at('delete', 'npc_vendor')).toBeLessThan(at('delete', 'creature_template'));
    expect(at('insert', 'creature_template')).toBeLessThan(at('insert', 'npc_vendor'));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/core/entities-vendor-compile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** as described. `scriptStatements` completes partial rows with schema column defaults via `defaultColumnValues`; the test's schema stub has empty column lists, so if `defaultColumnValues` throws on that stub, build the stub with `columnsOf`-style entries copied from the pattern in `tests/core/entities-statements.test.ts` instead.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/core/entities-vendor-compile.test.ts tests/core/entities-compile.test.ts tests/core/entities-statements.test.ts tests/core/entities-project-compile.test.ts`
Expected: PASS. Existing tests that enumerate every `deletes` key or all `npc_vendor`-less statements may need `npc_vendor` added to their expected values; that is the intended change.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): compile a new NPC's vendor stock"
```

---

### Task 4: Validation

**Files:**
- Modify: `src/core/entities/validate.ts` (vendor checks, new optional input `knownItem`)
- Modify: `src/main/api/checks.ts` (`newEntityIssues`: build `knownItem`)
- Test: `tests/core/entities-vendor-validate.test.ts` (create)

**Interfaces:**
- Consumes: `CustomNpc.vendor`.
- Produces: `entityIssues` input gains `knownItem?: ((id: number) => boolean) | null` (null/absent skips the existence check). New issue codes, all with `fieldId: ENTITIES_FIELD` and message prefixed by the entity label like the others:
  - `VENDOR_NO_ITEM` (error): "a stock row has no item."
  - `VENDOR_DUPLICATE` (error): "item N is listed twice with the same extended cost; the database allows each pair once." Reported once per duplicated pair.
  - `VENDOR_UNKNOWN_ITEM` (warning): "item N is neither in the world database nor in this project." Only when `knownItem` is given.
- `checks.ts`: collect all vendor item ids of project NPCs, read `item_template` rows for them with `rowsOrNone`, and pass `knownItem` true for ids in those rows or in `entities.items`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/entities-vendor-validate.test.ts
import { describe, expect, it } from 'vitest';
import { entityIssues } from '../../src/core/entities/validate';
import { newNpc, newSpawn, type CustomNpc, type VendorItem } from '../../src/core/entities/model';

const stock = (item: number, extendedCost = 0): VendorItem => ({ item, maxCount: 0, restockSecs: 0, extendedCost });
const npc = (vendor: VendorItem[]): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', displayId: 1, spawns: [{ ...newSpawn(1), x: 1 }], vendor });
const issues = (vendor: VendorItem[], known: ((id: number) => boolean) | null = null) =>
  entityIssues({ entities: { npcs: [npc(vendor)], objects: [], items: [] }, dbNames: new Map(), knownItem: known });
const codes = (list: ReturnType<typeof issues>) => list.map((i) => `${i.severity}:${i.code}`);

describe('vendor stock checks', () => {
  it('accepts a clean list', () => {
    expect(issues([stock(159), stock(159, 77)], () => true)).toEqual([]);
  });
  it('errors on a row with no item', () => {
    expect(codes(issues([stock(0)]))).toEqual(['error:VENDOR_NO_ITEM']);
  });
  it('errors once per repeated item and extended cost pair', () => {
    expect(codes(issues([stock(5), stock(6), stock(5), stock(5)]))).toEqual(['error:VENDOR_DUPLICATE']);
    expect(issues([stock(5), stock(5)])[0]!.message).toContain('item 5');
  });
  it('warns about an item nothing has, only when it can tell', () => {
    expect(codes(issues([stock(999)], (id) => id !== 999))).toEqual(['warning:VENDOR_UNKNOWN_ITEM']);
    expect(codes(issues([stock(999)], null))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/entities-vendor-validate.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the three checks inside `check` for entities that have `vendor` (NPCs only, using the `'vendor' in entity` narrowing style already used for `equipment`), and the `knownItem` plumbing in `checks.ts`.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core/entities-vendor-validate.test.ts tests/core/entities-validate.test.ts tests/main` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(core): validate vendor stock"
```

---

### Task 5: MCP authoring and docs for the field

**Files:**
- Modify: `src/core/authoring/guides.ts` (NPC guide: field list, a "vendor" explanation, checks)
- Modify: `src/core/authoring/examples.ts` (`npcExample` gets a `vendor`; the reading mentions it)
- Modify: `site/src/content/docs/guides/npcs-and-objects.md`, `site/src/content/docs/reference/database-tables.md` (`npc_vendor` row in the tables table, next to Loot), `site/src/content/docs/guides/ai-mcp.md` only if it lists NPC fields
- Test: existing `tests/core/authoring-models.test.ts` and the guides/docs tests (find with `grep -l guides tests/core tests/docs tests/main`); extend with the assertions below.

**Interfaces:**
- Consumes: `vendor` on the `npc` zod schema (automatic via `projectEntitiesSchema`; no change to `models.ts` needed, verify).

- [ ] **Step 1: Write the failing tests** — add to `tests/core/authoring-models.test.ts`:

```ts
import { jsonSchemaOf } from '../../src/core/authoring/models';
import { examplesOf } from '../../src/core/authoring/examples';
import { guideOf } from '../../src/core/authoring/guides'; // use the guide accessor the existing guides test already imports

it('the NPC model and guide cover vendor stock', () => {
  const props = (jsonSchemaOf('npc') as { properties: Record<string, unknown> }).properties;
  expect(props).toHaveProperty('vendor');
  const example = examplesOf('npc')[0]!;
  expect((example.value as { vendor: unknown[] }).vendor.length).toBeGreaterThan(0);
  const guide = guideOf('npc');
  for (const word of ['vendor', 'maxCount', 'restockSecs', 'extendedCost', 'VENDOR_DUPLICATE', 'VENDOR_NO_ITEM', 'VENDOR_UNKNOWN_ITEM']) expect(guide).toContain(word);
});
```

(Use whatever the existing guides test calls to get a guide's text; if the accessor has a different name, import that one.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/authoring-models.test.ts` — Expected: FAIL (example/guide lack vendor).
- [ ] **Step 3: Implement.** Guide text, in the style of the existing bullets: `vendor` — what it sells, an ordered list of `{ item, maxCount, restockSecs, extendedCost }`; `maxCount` 0 is unlimited (and `restockSecs` is then ignored); `extendedCost` is an `ItemExtendedCost.dbc` id (0 for gold only; the price in gold is the item's buy price); an NPC with any stock is a vendor, none is not; an existing database vendor arrives with its stock already in `vendor`; replacing the list replaces all of it. List the three new check codes under "What the editor checks". Example: a vendor selling two items (one limited with a restock time). Docs: one short section "Selling things" in `npcs-and-objects.md` describing the Vendor tab and the right-click items (written in Task 6/8 UI terms: tab name "Vendor", empty-state button "Make this NPC a vendor", menu items "Make vendor…" and "Edit vendor stock…", "Copy stock from…").
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/core tests/docs tests/main/mcp*` — Expected: PASS (docs tests include any "every table is documented" or link checks; fix what they report).
- [ ] **Step 5: Commit**

```bash
git add src site tests
git commit -m "docs: vendor stock in the NPC guide, example and docs"
```

---

### Task 6: Extended cost picker data (DBC) and item buy price

**Files:**
- Create: `src/core/game/extended-costs.ts`
- Modify: `src/core/db/types.ts` (`RefKind` + `'extendedCost'`), `src/shared/ipc/requests.ts` (`REF_KINDS` + `'extendedCost'`), `src/core/db/entity-search.ts` (`SearchKind` + `'extendedCost'`), `src/renderer/state/names.tsx` (`SUPPORTED_KINDS`)
- Modify: `src/main/api/connection.ts` (`Session.extendedCosts?: Promise<ExtendedCostIndex | { reason: string }>`), `src/main/api/server-files.ts` (`extendedCostsOf`, returned from `createServerFiles`), `src/main/api/lookup-api.ts` (search + names branches)
- Modify: `src/main/api/entities-api.ts` and `src/shared/ipc/entities.ts` (`entityTemplate('item', …)` also returns `buyPrice`)
- Test: `tests/core/extended-costs.test.ts` (create), `tests/main/api-extended-cost.test.ts` (create), update `tests/main/api-items.test.ts` expectation (line ~67) to include `buyPrice`

**Interfaces:**
- Produces (core): 
  - `EXTENDED_COST_FILE = 'ItemExtendedCost.dbc'`
  - `interface ExtendedCost { id: number; honor: number; arena: number; rating: number; items: { item: number; count: number }[] }` (items with `item` 0 or `count` 0 are dropped)
  - `readExtendedCosts(bytes: Uint8Array): Map<number, ExtendedCost>` — 3.3.5a layout, 15 fields: `0` id, `1` honor points, `2` arena points, `3` arena slot (ignored), `4..8` item ids, `9..13` item counts, `14` personal arena rating. A file with fewer than 15 fields throws `DbcFormatError` ("… has N fields; a 3.3.5a file has 15.").
  - `extendedCostLabel(cost: ExtendedCost, itemName: (id: number) => string | undefined): string` — parts joined by `' + '`: `"<honor> honor"`, `"<arena> arena points"`, then `"<count> <name>"` per item (name falls back to `item <id>`); a rating appends `" (rating <n>)"`; no parts gives `"No cost"`. Example: `2000 honor + 1 Mark of Honor`.
  - `interface ExtendedCostIndex { get(id: number): string | undefined; search(text: string, limit: number): { id: number; name: string }[] }` and `buildExtendedCostIndex(costs: Map<number, ExtendedCost>, itemName: (id: number) => string | undefined): ExtendedCostIndex` — `get` returns the label; `search`: a whole number typed in full that exists returns that cost alone; otherwise case-insensitive label substring matches, labels starting with the text first, then ids ascending, up to `limit`; empty text returns `[]`.
- Main: `extendedCostsOf(live)` follows `soundsOf`: needs `live.serverData?.status.dir` (reason "Extended costs need the server data folder." when absent), reads the file with `readServerDataFile`, resolves the distinct item ids to names with `live.db.lookupNames('item', ids)`, builds the index; any failure is a `{ reason }`. `searchEntities('extendedCost', text)` returns `index.search(text, ENTITY_SEARCH_LIMIT)` (or `[]` on a reason); `lookupNames('extendedCost', ids)` maps ids found to labels.
- `EntityTemplate` item shape gains `buyPrice` (copper, from `itemFromRows(...).buyPrice`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/extended-costs.test.ts
import { describe, expect, it } from 'vitest';
import { buildExtendedCostIndex, extendedCostLabel, readExtendedCosts } from '../../src/core/game/extended-costs';

/** A WDBC file of 15-field records: id, honor, arena, slot, 5 item ids, 5 item counts, rating */
function dbc(records: number[][]): Uint8Array {
  const out = new Uint8Array(20 + records.length * 60 + 1);
  const view = new DataView(out.buffer);
  out.set([0x57, 0x44, 0x42, 0x43]);
  view.setUint32(4, records.length, true);
  view.setUint32(8, 15, true);
  view.setUint32(12, 60, true);
  view.setUint32(16, 1, true);
  records.forEach((r, i) => r.forEach((v, f) => view.setUint32(20 + i * 60 + f * 4, v, true)));
  return out;
}
const record = (id: number, honor: number, arena: number, items: [number, number][], rating = 0) =>
  [id, honor, arena, 0, ...Array.from({ length: 5 }, (_, i) => items[i]?.[0] ?? 0), ...Array.from({ length: 5 }, (_, i) => items[i]?.[1] ?? 0), rating];
const names = new Map([[20559, 'Mark of Honor']]);

describe('item extended costs', () => {
  const costs = readExtendedCosts(dbc([record(1, 2000, 0, [[20559, 1]]), record(2, 0, 1500, [], 1700), record(3, 0, 0, [])]));

  it('reads each record', () => {
    expect(costs.get(1)).toEqual({ id: 1, honor: 2000, arena: 0, rating: 0, items: [{ item: 20559, count: 1 }] });
    expect(costs.get(2)).toMatchObject({ arena: 1500, rating: 1700, items: [] });
  });
  it('rejects a file with too few fields', () => {
    const short = dbc([record(1, 0, 0, [])]);
    new DataView(short.buffer).setUint32(8, 10, true);
    expect(() => readExtendedCosts(short)).toThrow(/10 fields/);
  });
  it('labels a cost readably', () => {
    const name = (id: number) => names.get(id);
    expect(extendedCostLabel(costs.get(1)!, name)).toBe('2000 honor + 1 Mark of Honor');
    expect(extendedCostLabel(costs.get(2)!, name)).toBe('1500 arena points (rating 1700)');
    expect(extendedCostLabel(costs.get(3)!, name)).toBe('No cost');
    expect(extendedCostLabel({ id: 9, honor: 0, arena: 0, rating: 0, items: [{ item: 5, count: 3 }] }, () => undefined)).toBe('3 item 5');
  });
  it('searches by id or by label', () => {
    const index = buildExtendedCostIndex(costs, (id) => names.get(id));
    expect(index.get(1)).toBe('2000 honor + 1 Mark of Honor');
    expect(index.get(99)).toBeUndefined();
    expect(index.search('2', 10).map((h) => h.id)).toEqual([2].filter((id) => costs.has(id)));
    expect(index.search('mark', 10)).toEqual([{ id: 1, name: '2000 honor + 1 Mark of Honor' }]);
    expect(index.search('', 10)).toEqual([]);
  });
});
```

For `tests/main/api-extended-cost.test.ts`, copy the `setup()` of `tests/main/api-existing.test.ts` but pass `serverDataFiles` to `createApi` serving `ItemExtendedCost.dbc` (build the bytes with the same helper, move it to `tests/helpers/` so both tests import it) and a profile with `dbcDir`; insert `item_template` `{ entry: '20559', name: 'Mark of Honor' }` into the fake DB; assert:
- `api.searchEntities('extendedCost', 'mark')` → `{ ok: true, value: [{ id: 1, name: '2000 honor + 1 Mark of Honor' }] }`
- `api.lookupNames('extendedCost', [1, 99])` → `{ 1: '2000 honor + 1 Mark of Honor' }`
- with no server data folder both give empty results, not errors
- `api.entityTemplate('item', 2589)` includes `buyPrice` (adjust the existing api-items expectation).
Look at how `tests/main/api-*.test.ts` already provide `serverDataFiles` and a `dbcDir` profile (search `serverDataFiles` in tests) and mirror it exactly.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/extended-costs.test.ts tests/main/api-extended-cost.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block. In `names.tsx` add `'extendedCost'` to `SUPPORTED_KINDS`; keep the `Exactly<…>` check in `requests.ts` compiling (add to `REF_KINDS` too). `lookup-api.ts`: add the two branches next to `sound`, using `extendedCostsOf` taken from `s.files`.
- [ ] **Step 4: Run to verify pass** — `npm run typecheck` then `npx vitest run tests/core tests/main` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(main): look up item extended costs from the server's DBC"
```

---

### Task 7: The Vendor tab

**Files:**
- Create: `src/renderer/entities/VendorList.tsx` (the table body), `src/renderer/entities/CopyStock.tsx` ("Copy stock from…")
- Modify: `src/renderer/entities/npc/NpcEditor.tsx` (a `Vendor` tab after Loot, id `vendor`)
- Test: `tests/renderer/entities-vendor.test.tsx` (create); update the tab-list assertion in `tests/renderer/npc-editor.test.tsx` line ~31 to `['Basics', 'Look & gear', 'Fight', 'Loot', 'Vendor', 'Placement']`

**Interfaces:**
- Consumes: `VendorItem` (Task 1), `EntityField` (`src/renderer/scripts/fields.tsx`, props `{ id, label, kind, value, onChange }`) with `kind="item"` and `kind="extendedCost"` (Task 6), `NumberField`, `useApi`, `useProjectEntities`.
- Produces: `VendorList({ idPrefix, vendor, onChange, hasServerData, onCopy? })` — controlled, renders the stock table; `CopyStock({ npcEntry, onCopy(vendor: VendorItem[]) })`.
- NpcEditor: tab `{ id: 'vendor', label: 'Vendor' }` renders, in this order: (a) when the NPC is existing and `!('npc_vendor' in npc.origin.original)`, only the hint "Its stock was not read when it was added to this project, so it is not edited here." (Review Focus 4); (b) otherwise the `VendorList`.

`VendorList` behavior:
- Empty list: a hint and a button **"Make this NPC a vendor"** that appends one blank row (`{ item: 0, maxCount: 0, restockSecs: 0, extendedCost: 0 }`).
- Each row is a `scene-step` like `LootList`: heading `Item N`, buttons **Up**, **Down**, **Remove** (Up disabled on the first row, Down on the last), an item `EntityField` labelled "Item", number fields "Max count" (min 0; hint "0 is unlimited") and "Restock (seconds)" (min 0, rounded; disabled and shown as 0 while max count is 0), and the extended cost: when `hasServerData` an `EntityField kind="extendedCost"` labelled "Extended cost"; otherwise a `NumberField` labelled "Extended cost (id)" and one hint "Names need the server data folder."
- Under the item field, the buy price when known: the item's `buyPrice` from the project's items (`useProjectEntities().entities.items`) or `api.entityTemplate('item', id)`, displayed as "Buy price: 1g 20s 5c" (omit zero parts; "Buy price: free" for 0). Not shown while the item is 0 or unknown.
- Button **"Add item"** appends a blank row. Numeric edits round to integers and never go below 0.
- `CopyStock`: an `EntityField kind="creature"` labelled "Copy stock from…" and a button **"Copy"** (disabled until an NPC is chosen). Copy replaces the vendor list with the chosen NPC's: from `useProjectEntities().entities.npcs` when the project holds it, else `api.readExistingEntity('npc', entry)` (its `vendor`). A read failure or an NPC with no stock shows `role="alert"` text "That NPC has no stock to copy." / the error message and changes nothing. If the current list is non-empty, ask `window.confirm("Replace this NPC's stock with …?")` first.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/renderer/entities-vendor.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcEditor } from '../../src/renderer/entities/npc/NpcEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { newNpc, type CustomNpc, type VendorItem } from '../../src/core/entities/model';

let current: CustomNpc = newNpc(12000001);
function Live({ start, hasServerData = true, api = makeMockApi() }: { start: CustomNpc; hasServerData?: boolean; api?: ReturnType<typeof makeMockApi> }) {
  const [npc, setNpc] = useState(start);
  current = npc;
  return <NamesProvider api={api}><NpcEditor npc={npc} onChange={(n) => { current = n; setNpc(n); }} allocateSpawn={async () => 900} hasServerData={hasServerData} tab="vendor" /></NamesProvider>;
}
const stock = (item: number, over: Partial<VendorItem> = {}): VendorItem => ({ item, maxCount: 0, restockSecs: 0, extendedCost: 0, ...over });
const withStock = (vendor: VendorItem[]): CustomNpc => ({ ...newNpc(12000001), name: 'Hela', vendor });
const rows = () => screen.getAllByRole('listitem');

describe('the Vendor tab', () => {
  it('starts with an empty state that makes the NPC a vendor with one blank row', async () => {
    render(<Live start={newNpc(12000001)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make this NPC a vendor' }));
    expect(current.vendor).toEqual([stock(0)]);
  });

  it('adds, edits and removes rows', async () => {
    render(<Live start={withStock([stock(159)])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(current.vendor).toHaveLength(2);
    const second = rows()[1]!;
    const max = within(second).getByLabelText('Max count');
    await userEvent.clear(max);
    await userEvent.type(max, '5');
    const restock = within(second).getByLabelText('Restock (seconds)');
    await userEvent.clear(restock);
    await userEvent.type(restock, '900');
    expect(current.vendor[1]).toMatchObject({ maxCount: 5, restockSecs: 900 });
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Remove' }));
    expect(current.vendor).toHaveLength(1);
    expect(current.vendor[0]).toMatchObject({ maxCount: 5 });
  });

  it('disables the restock time while stock is unlimited', () => {
    render(<Live start={withStock([stock(159, { maxCount: 0 })])} />);
    expect(within(rows()[0]!).getByLabelText('Restock (seconds)')).toBeDisabled();
  });

  it('reorders rows', async () => {
    render(<Live start={withStock([stock(1), stock(2), stock(3)])} />);
    expect(within(rows()[0]!).getByRole('button', { name: 'Up' })).toBeDisabled();
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Down' }));
    expect(current.vendor.map((v) => v.item)).toEqual([2, 1, 3]);
    await userEvent.click(within(rows()[2]!).getByRole('button', { name: 'Up' }));
    expect(current.vendor.map((v) => v.item)).toEqual([2, 3, 1]);
  });

  it('picks an extended cost by name, or by number without the server data folder', async () => {
    const api = makeMockApi({
      searchEntities: vi.fn(async (kind: string) => okv(kind === 'extendedCost' ? [{ id: 77, name: '2000 honor + 1 Mark of Honor' }] : [])),
      lookupNames: vi.fn(async () => okv({})),
    });
    const { unmount } = render(<Live start={withStock([stock(159)])} api={api} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Extended cost' }), 'mark');
    await userEvent.click(await screen.findByRole('option', { name: /2000 honor/ }));
    expect(current.vendor[0]!.extendedCost).toBe(77);
    unmount();
    render(<Live start={withStock([stock(159)])} hasServerData={false} />);
    const field = screen.getByLabelText('Extended cost (id)');
    await userEvent.clear(field);
    await userEvent.type(field, '12');
    expect(current.vendor[0]!.extendedCost).toBe(12);
    expect(screen.getByText(/need the server data folder/i)).toBeTruthy();
  });

  it('shows an item\'s buy price', async () => {
    const api = makeMockApi({ entityTemplate: vi.fn(async () => okv({ name: 'Linen Cloth', displayId: 1, itemClass: 7, subclass: 5, inventoryType: 0, buyPrice: 12050 })) });
    render(<Live start={withStock([stock(2589)])} api={api} />);
    expect(await screen.findByText('Buy price: 1g 20s 50c')).toBeTruthy();
  });

  it('copies another NPC\'s stock in, asking before it replaces any', async () => {
    const source = { ...newNpc(68), name: 'Guard', vendor: [stock(10), stock(11)] };
    const api = makeMockApi({
      readExistingEntity: vi.fn(async () => okv(source)),
      searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Live start={withStock([stock(1)])} api={api} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Copy stock from…' }), 'guard');
    await userEvent.click(await screen.findByRole('option', { name: /Guard/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(current.vendor.map((v) => v.item)).toEqual([10, 11]);
  });

  it('does not copy from an NPC with no stock', async () => {
    const api = makeMockApi({
      readExistingEntity: vi.fn(async () => okv({ ...newNpc(68), name: 'Guard' })),
      searchEntities: vi.fn(async () => okv([{ id: 68, name: 'Guard' }])),
    });
    render(<Live start={withStock([stock(1)])} api={api} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Copy stock from…' }), 'guard');
    await userEvent.click(await screen.findByRole('option', { name: /Guard/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That NPC has no stock to copy.');
    expect(current.vendor.map((v) => v.item)).toEqual([1]);
  });

  it('leaves the stock of a project saved before vendors were read alone', () => {
    const old: CustomNpc = { ...newNpc(54), name: 'Innkeeper', origin: { kind: 'existing', original: { creature_template: [{ entry: '54' }] }, sharedLoot: 0, spawnCount: 1, locked: [] } };
    render(<NamesProvider api={makeMockApi()}><NpcEditor npc={old} onChange={vi.fn()} allocateSpawn={async () => null} existing={{ sharedLoot: 0, spawnCount: 1, locked: [] }} tab="vendor" /></NamesProvider>);
    expect(screen.getByText(/stock was not read/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make this NPC a vendor' })).toBeNull();
  });
});
```

(`tab="vendor"` selects the tab by id the way `mountEditor`/`EditorTabs` already do; if `EditorTabs` matches by label in this codebase, pass `tab="Vendor"` — check `tests/renderer/entities-loot.test.tsx`, which passes the label.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/renderer/entities-vendor.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the two components and the tab per the Interfaces block, reusing the CSS classes `LootList` uses (`scene-section`, `scene-steps`, `scene-step`, `entry-card__btn`). Money formatting: write a small pure helper `formatCoin(copper)` in `src/core/format/money.ts` (or an existing money helper if `src/renderer/controls/MoneyControl.tsx` already exports one — reuse it then) returning "1g 20s 50c" style text.
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/renderer` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(renderer): Vendor tab for NPCs"
```

---

### Task 8: Right-click menu and opening on the Vendor tab

**Files:**
- Modify: `src/core/db/mysql-world-db.ts` (creature view query also selects `t.npcflag AS npcflag`), `src/core/db/view-spawns.ts` (`ViewCreature.npcFlags?: number`, `toViewCreature`), `src/renderer/world3d/scene/spawn/SpawnManager.ts` (`SpawnInfo.npcFlags?: number`, `info()` for creatures)
- Modify: `src/core/entities/entity.ts` (`NpcSpawn.vendor: number | null` — stock count when known, `null` when the NPC is a database one the project has not opened and its flags say nothing)
- Modify: `src/renderer/world3d/menu/subject.ts` (`spawnedEntityOf` fills `vendor`)
- Create: `src/renderer/world3d/menu/sections/vendor.ts`; Modify: `sections/index.ts` (register after `loot`)
- Modify: `src/renderer/world3d/menu/model.ts` (`MenuAction` `{ kind: 'editEntity'; spawn: MenuSpawn; tab?: string }`), `useWorldMenu.tsx` (pass the tab on), `World3DView.tsx` / `WorldWorkspace.tsx` (`onEditEntity(kind, entry, tab?)` → `setEditor({ kind, entry, isNew: false, tab })`)
- Test: `tests/renderer/world3d-menu-sections.test.ts` (extend and update the section-order assertion), `tests/core/entities-spawn-vendor.test.ts` is not needed

**Interfaces:**
- `NpcSpawn` (in `entity.ts`) gains `vendor: { sells: boolean; count: number | null }`. `spawnedEntityOf(info, store)` fills it: when the project holds the NPC, `count = stored.vendor.length` and `sells = count > 0`; otherwise `count = null` and `sells = ((info.npcFlags ?? 0) & 128) !== 0`.
- Section `vendor` (`MenuSection<SpawnSubject>`, id `'vendor'`, group `'world'`): applies to NPC spawns only. The item is labelled `Edit vendor stock…` when `vendor.sells`, else `Make vendor…`. For the count hint, add an optional `hint?: string` to `MenuItem` (rendered by the menu component as muted trailing text; find where `MenuItem.label` is rendered) and set `hint` to `"N items"` (`"1 item"` for one) when `count` is a number greater than 0; no hint otherwise. An existing NPC (the `edit` section's rule: `target.origin === 'existing'`) with `!context.connected` gets `disabledReason: NEEDS_DATABASE`. Action: `{ kind: 'editEntity', spawn: info, tab: 'vendor' }`.
- `editEntity` stays an edit (not in `READS`), so the AI-writing lock disables it automatically.

- [ ] **Step 1: Write the failing tests** (extend `tests/renderer/world3d-menu-sections.test.ts`, which already defines `npc`, `hela`, `store`, `on`, `context`, `item`, `buildMenu`):

```ts
describe('the vendor section', () => {
  const vendorStore: ProjectEntities = { ...store, npcs: [{ ...newNpc(12000001), name: 'Hela', vendor: [{ item: 1, maxCount: 0, restockSecs: 0, extendedCost: 0 }, { item: 2, maxCount: 0, restockSecs: 0, extendedCost: 0 }] }] };

  it('offers Make vendor… on an NPC without stock, opening the Vendor tab', () => {
    const entry = item(buildMenu(on(hela), context()), 'Make vendor…')!;
    expect(entry.action).toEqual({ kind: 'editEntity', spawn: hela, tab: 'vendor' });
  });
  it('offers Edit vendor stock… with the count on a project NPC that has stock', () => {
    const entry = item(buildMenu(on(hela, vendorStore), context()), 'Edit vendor stock…')!;
    expect(entry.hint).toBe('2 items');
    expect(item(buildMenu(on(hela, vendorStore), context()), 'Make vendor…')).toBeUndefined();
  });
  it('reads a database NPC the project has not opened from its flags', () => {
    expect(item(buildMenu(on(npc({ npcFlags: 129 })), context()), 'Edit vendor stock…')).toBeDefined();
    expect(item(buildMenu(on(npc({ npcFlags: 1 })), context()), 'Make vendor…')).toBeDefined();
    expect(item(buildMenu(on(npc({ npcFlags: 129 })), context()), 'Edit vendor stock…')!.hint).toBeUndefined();
  });
  it('needs the world database for a database NPC, not for a project one', () => {
    expect(item(buildMenu(on(npc()), context({ connected: false })), 'Make vendor…')!.disabledReason).toBe('Needs the world database');
    expect(item(buildMenu(on(hela), context({ connected: false })), 'Make vendor…')!.action).toBeDefined();
  });
  it('is not offered on an object or while placing', () => {
    expect(item(buildMenu(on(chest), context()), 'Make vendor…')).toBeUndefined();
    expect(item(buildMenu(on(hela), context({ placing: true })), 'Make vendor…')).toBeUndefined();
  });
  it('waits while an AI client writes', async () => {
    const { editsProject } = await import('../../src/renderer/world3d/menu/model');
    expect(editsProject({ kind: 'editEntity', spawn: hela, tab: 'vendor' })).toBe(true);
  });
});
```

Also: update the "registers the sections in the spec order" array to `['busy', 'create', 'edit', 'loot', 'vendor', 'clipboard', …]`. Add a workspace/host test that the menu action opens the editor on the tab: in the existing world3d context-menu test (`tests/renderer/world3d-context-menu.test.tsx`) follow how `editEntity` is asserted today and assert `onEditEntity` receives `('creature', entry, 'vendor')`. For the data path, extend the existing view-spawns test (`grep -l toViewCreature tests`) with a row carrying `npcflag: '129'` giving `npcFlags: 129`, and the mysql view query test with the new column if it asserts the SQL.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/renderer/world3d-menu-sections.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block (ensure `npcFlags` is `undefined` for NPCs placed in the 3D view layer, which are project NPCs anyway, and for rows whose `npcflag` is NULL/absent).
- [ ] **Step 4: Run to verify pass** — `npm run typecheck && npx vitest run tests/renderer tests/core tests/main` — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(world): Make vendor… and Edit vendor stock… in the right-click menu"
```

---

### Task 9: Docs, screenshot hook and final verification

**Files:**
- Modify: `site/src/content/docs/guides/npcs-and-objects.md` (finish the "Selling things" section from Task 5 with the final UI wording: Vendor tab, restock, extended cost needs the server data folder, Copy stock from…, right-click items), `site/src/content/docs/guides/the-world.md` (right-click menu list, if it lists items), `site/src/content/docs/reference/database-tables.md`
- Test: `tests/docs` suite, whole suite

- [ ] **Step 1:** Update the docs pages above to match what shipped; if the guides list the NPC editor tabs, add Vendor.
- [ ] **Step 2: Run the whole verification**

Run: `npm run typecheck && npm test`
Expected: all green. Then `npm --prefix site run build` if docs have a build test locally runnable; expected: builds without broken links.
- [ ] **Step 3: Manual check in the app** (use the `run` skill): open an existing vendor NPC (for example Stormwind's `Innkeeper Allison`, entry 6740) via right-click → "Edit vendor stock…", confirm its stock appears, change one row and reorder, open Project changes and confirm the export preview shows `npc_vendor` delete + inserts and no `creature_template` change other than the intended `npcflag`; then reopen and confirm "Put back as the database has it" restores it. Report anything that differs from the spec.
- [ ] **Step 4: Commit**

```bash
git add site tests
git commit -m "docs: NPC vendors"
```
