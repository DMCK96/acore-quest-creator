# NPC vendors: design

Part 1 of 3 of "expand NPC editing" (vendors, then trainers, then generic scripts and gossip).
Trainers and scripts get their own specs.

## Goal

An author can make any NPC, new or existing, a vendor and edit the items it sells. If an existing
NPC is already a vendor, opening it shows its current stock, ready to edit. The right-click menu
reflects whether the NPC already sells things.

## Scope

In:
- Every `npc_vendor` column: `item`, `maxcount`, `incrtime`, `ExtendedCost`, `slot` (order).
- Detecting and loading an existing NPC's stock; editing it as row-level changes.
- A "Vendor" tab in the NPC editor, right-click items, MCP support, docs, tests.
- Picking an extended cost from the ones already in the client DBC, shown readably.
- Copying another vendor's stock into this one.

Out (for now):
- `game_event_npc_vendor` (stock that depends on a game event).
- Authoring new `ItemExtendedCost` rows (needs DBC writes and a client patch).
- Sharing one stock list between NPCs (`npc_vendor` is keyed by NPC entry; copy covers reuse).

## Model

`CustomNpc` (`src/core/entities/model.ts`) gains

```ts
vendor: z.array(vendorItemSchema).default([])   // ordered; index is the slot
vendorItem = { item: int, maxCount: int.min(0), restockSecs: int.min(0), extendedCost: int.min(0) }
```

- Order in the array is the display order; export writes `slot` from it.
- `maxCount = 0` is unlimited stock (`restockSecs` is then ignored and written as 0).
- An NPC is a vendor when `vendor.length > 0`; there is no separate flag in the model.
  Export sets or clears the vendor bit of `npcflag` from that.
- `npcflag` bit 128 (vendor) is the only bit toggled. The sub-type bits (ammo, food, poison,
  reagent), gossip and every other bit are kept as the database has them, as `npcflag` already is.
- The default keeps NPCs saved before this change as they were (same as `loot`).

## Existing NPCs: detect and edit

- `from-rows.ts`: `npcFromRows` reads `npc_vendor` rows (new entry in the `OriginalRows` the
  existing-entity loader fetches, in `src/main/entities/existing.ts`) into `vendor`, ordered by `slot`.
- The original rows are kept in `origin.original.npc_vendor`, so revert restores them.
- Compile (`existing.ts`, `npcStatements`): write `npc_vendor` with `writeTable` keyed by `entry`, like
  `creature_loot_template`: delete the NPC's rows, insert the current ones. Untouched columns on
  rows that still exist (`VerifiedBuild`) are carried over from the original row for the same
  `(item, ExtendedCost)` key.
- Only written when the vendor list differs from what was read, so opening an NPC never changes it.
- New NPCs: `compile.ts` writes the same rows next to its `creature_template` insert.
- No lock is needed: a vendor list is owned by one `entry`, unlike shared loot.
- Conflict to surface in validation: the same `(item, extendedCost)` pair twice (primary key).

## UI

- `NpcEditor.tsx` gets a **Vendor** tab (after Loot), built like `LootList.tsx`: a table with item
  picker (existing item search, with the item's buy price shown), max count, restock time,
  extended cost picker, reorder, remove. An empty state with "Make this NPC a vendor".
- Extended cost picker reads `ItemExtendedCost.dbc` through the existing DBC reader
  (`src/core/game/dbc.ts`) and shows "2000 honor + 1 Mark of Honor". Without a client folder it
  falls back to a number field with a note.
- "Copy stock from…" picks another NPC (existing or project) and copies its list in.
- An item that does not exist in the world DB or project is flagged by validation (`validate.ts`).

## Right-click menu

New section file `src/renderer/world3d/menu/sections/vendor.ts`, registered in `sections/index.ts`,
group `world`:
- NPC without stock: "Make vendor…"
- NPC with stock: "Edit vendor stock…" with the item count as a hint
Both open the NPC editor on the Vendor tab (`editEntity` gains a tab parameter). They are not in
`READS`, so they are disabled while an AI write runs, like other edits.

## MCP and docs

- Authoring model (`src/core/authoring/models.ts`, `guides.ts`, `examples.ts`) gains the `vendor` field,
  so `new_entity`, `entity_template` and `upsert_entity` handle it. No new tool.
- Docs: `guides/npcs-and-objects.md`, `reference/database-tables.md` (`npc_vendor`), `guides/ai-mcp.md`
  if it lists NPC fields.

## Testing

- Core: `from-rows` reads vendors in slot order; `existing.ts` produces delete + insert only when
  changed; no statements when unchanged; vendor bit set and cleared with sub-type bits preserved;
  new-NPC compile; duplicate-key validation; revert restores originals.
- Main: existing-entity loader returns `npc_vendor` rows (fake world DB).
- Renderer: Vendor tab add, edit, reorder and remove; extended-cost picker; menu item changes
  with stock.
- MCP: authoring examples validate against the schema (existing docs and guides tests).
