# NPC trainers: design

Part 2 of 3 of "expand NPC editing" (vendors, then trainers, then generic scripts and gossip).
Vendors are in [2026-10-09-npc-vendors-design.md](2026-10-09-npc-vendors-design.md); this design follows
their pattern and reuses their pieces wherever it can.

## Goal

An author can make any NPC, new or existing, a trainer and edit the spells it teaches. If an existing NPC is
already a trainer, opening it shows its current spells, ready to edit. The right-click menu reflects whether
the NPC already trains. A trainer that other NPCs share is never changed by accident: the editor locks it and
offers to give this NPC its own copy.

## Scope

In:
- The trainer's spell list: for each spell its cost, required level, required skill line and rank, and
  prerequisite spells.
- The trainer's type (class, mount, profession, pet) and its greeting, on the NPC's own trainer.
- Making a new NPC a trainer with its own new trainer (new trainer id, type, greeting, spells).
- Detecting and loading an existing NPC's trainer; editing it as row-level changes.
- Giving an NPC whose trainer is shared its own copy of it.
- A "Trainer" tab in the NPC editor, right-click items, MCP support, docs, tests.
- Copying another NPC's trainer spells into this one.

Out (for now):
- The trainer's `Requirement` column and translated greetings (`trainer_locale`).
- Authoring spells (`Spell.dbc`) or what a spell teaches; a trainer only lists spells that exist.
- Pointing several NPCs at one new trainer (copy covers reuse; sharing is only ever the database's).
- The vendor and the game-event tables; trainer pets' talent trees; class-only gossip menus.

## Database

AzerothCore's trainer tables, assumed from stock 3.3.5 AzerothCore (see "Assumptions to verify"):

| Table | Key | Holds |
| --- | --- | --- |
| `creature_default_trainer` | `CreatureId` | which trainer an NPC uses: `CreatureId`, `TrainerId` |
| `trainer` | `Id` | `Id`, `Type` (0 class, 1 mount, 2 profession, 3 pet), `Requirement`, `Greeting` |
| `trainer_spell` | `TrainerId`, `SpellId` | `MoneyCost`, `ReqSkillLine`, `ReqSkillRank`, `ReqAbility1..3` (prerequisite spells), `ReqLevel` |

An NPC is a trainer through `creature_default_trainer` and bit 16 of `npcflag`. Several NPCs can point at one
`trainer` row, which is how class trainers share a list.

## Model

`CustomNpc` (`src/core/entities/model.ts`) gains

```ts
trainer: trainerSchema.nullable().default(null)
trainer = { trainerId: int, type: enum(TRAINER_TYPES), greeting: string,
            spells: array(trainerSpell) }                // order is only the editor's display order
trainerSpell = { spell: int, cost: int.min(0), reqLevel: int.min(0), reqSkill: int.min(0),
                 reqSkillRank: int.min(0), reqSpells: array(int.positive()).max(3) }
```

- An NPC is a trainer when `trainer` is not null; there is no separate flag. Export sets or clears the
  trainer bit (16) of `npcflag` from that; every other bit (including the class and profession sub-type bits)
  stays as the database has it. A new NPC gets the sub-type bit stock trainers of its `type` carry.
- `trainerId` is pinned like a guid: allocated once, when the trainer is made or copied, from above the
  database's highest `trainer.Id` and the project's. An existing NPC keeps the id it reads.
- `trainer = null` on an NPC that read a trainer means "no longer a trainer": export removes its
  `creature_default_trainer` row and the vendor-style change check decides whether anything is written.
- The default `null` keeps NPCs saved before this change as they were.

## Existing NPCs: detect, edit, copy

- `from-rows.ts`: `npcFromRows` reads the NPC's `creature_default_trainer` row, then its `trainer` row and
  `trainer_spell` rows (new entries in the `OriginalRows` `readOriginalRows` fetches, in
  `src/core/entities/existing.ts`) into `trainer`.
- The original rows stay in `origin.original`, so revert restores them.
- Shared trainer: `readExistingRows` (`src/main/entities/existing.ts`) counts the other NPCs whose
  `creature_default_trainer` names the same trainer, like `sharedLoot`. When it is more than zero the
  trainer part is locked (`EntityLock` gains `'trainer'`) and the Trainer tab shows a warning with
  **Give it its own copy**.
- Give it its own copy: allocates a new `trainerId`, keeps the spells, type and greeting, and takes `'trainer'`
  out of `origin.locked`, which is what makes the trainer the NPC's own. A trainer whose `trainerId` differs
  from the one read is always written as new rows; the trainer it was read from is never deleted or rewritten. Export then writes a new `trainer` and `trainer_spell` set and points this NPC's
  `creature_default_trainer` row at it, and leaves the shared trainer untouched.
- Compile (`existing.ts`, `npcStatements`), only when the trainer differs from what was read:
  - `creature_default_trainer` by `CreatureId`: delete, insert the new row (none when no longer a trainer).
  - `trainer` by `Id` and `trainer_spell` by `TrainerId`: delete the NPC's own trainer, insert the current rows.
    Columns the editor does not model (`Requirement`, `VerifiedBuild`) are carried over from the original
    row with the same key.
  - A trainer that is still shared is never written (it is locked).
  - Opening an NPC never changes it.
- A project saved before this change has no trainer keys in `origin.original`: its trainer is left alone, and
  the Trainer tab says so, exactly as for vendor stock. A fork without the trainer tables is treated the
  same way (the tab says its database has no trainer tables).
- New NPCs: `compile.ts` writes the same rows next to its `creature_template` insert, and deletes its
  trainer's rows by id on every export so a removed spell does not linger.

## Validation (`validate.ts`)

Errors (stop an export):
- `TRAINER_NO_SPELL`: a spell row with no spell.
- `TRAINER_DUPLICATE`: the same spell twice (primary key).
- `TRAINER_REQ_SPELL`: a prerequisite that is the spell itself.

Warnings:
- `TRAINER_EMPTY`: a trainer with no spells.
- `TRAINER_UNKNOWN_SPELL`: a spell not in the server's spell list (reuses the fight check's `knownSpell`).
- `TRAINER_NOT_READ`: trainer set on an existing NPC whose trainer was never read, so it is not written.
- `TRAINER_ID_TAKEN`: a new trainer's id is already a trainer in the database that this project did not read.

## UI

- `NpcEditor.tsx` gets a **Trainer** tab after **Vendor**, built like `VendorList.tsx`.
- Empty state: **Make this NPC a trainer**, which asks for the type and greeting and allocates the trainer id.
- With a trainer: **Type** (select) and **Greeting** (text) at the top, then a spell table: spell picker
  (the existing spell search, with its rank and cost line), **Cost** in gold/silver/copper, **Required level**,
  **Skill** (picker over `skills.ts`, with a number fallback) and **Skill rank**, **Needs spells** (up to
  three spell pickers), **Remove**, and **Add spell**.
- **Copy spells from…** picks another NPC (existing or project) and replaces this list with its spells, asking
  first when the list is not empty (reusing `CopyStock`'s pattern).
- **Remove trainer** returns the NPC to not training, after confirmation when it has spells.
- A locked (shared) trainer shows its spells read-only with the count of other NPCs and **Give it its own copy**.

## Right-click menu

New section `src/renderer/world3d/menu/sections/trainer.ts`, registered after `vendor`, group `world`:
- NPC that is not a trainer: **Make trainer…**
- NPC that is a trainer: **Edit trainer spells…**, with the count as a hint when the project holds it.
- Whether an unopened database NPC trains comes from its `npcflag` trainer bit, which the spawn view query
  already selects for vendors (`npcFlags`).
Both open the NPC editor on the Trainer tab through `editEntity`'s `tab` (the `MenuEditorTab` union gains
`'trainer'`). They are edits, so they are disabled while an AI write runs.

## MCP and docs

- The authoring model gains `trainer`, so `new_entity`, `upsert_entity` and the `npc` JSON schema carry it;
  `guides.ts` (fields, the three-way sharing note, check codes) and `examples.ts` (a class trainer with two
  spells). No new tool; `allocate_ids` gains the kind `trainer`.
- Docs: `guides/npcs-and-objects.md` (a "Teaching spells" section), `reference/database-tables.md`
  (the three tables), `guides/the-world.md` (the menu items), `guides/ai-mcp.md`.

## Assumptions to verify when planning

The plan's first step checks these against the fork's real schema, using the app's own schema loader and the
Conquest of AzerothCore DDL, before any task is written around them:
- The three tables and every column named above exist (in particular `trainer.Requirement`, which this
  spec carries over but does not edit, and `trainer_spell.ReqAbility1..3`).
- Which `npcflag` sub-type bits stock class, profession, mount and pet trainers carry.
- That no `npc_trainer` or per-template trainer columns remain in use. If the fork still uses the older shape,
  this design stops and returns to review: the data model would change, not just its columns.

## Testing

- Core: `from-rows` reads a trainer with its spells; `existing.ts` writes only when changed, replaces rows
  by key and carries unmodelled columns; a shared trainer is locked and writes nothing; giving it its own
  copy points `creature_default_trainer` at a new id and leaves the shared rows alone; the trainer bit is set
  and cleared with other bits kept; unread keys and a missing table leave the trainer alone; revert restores
  originals; new-NPC compile and re-export cleanup; every validation code.
- Main: the existing-entity loader returns trainer rows and the shared count (fake world DB); `allocate_ids`
  for `trainer`; validation uses the real spell list when loaded.
- Renderer: Trainer tab empty state, add/edit/remove spells, type and greeting, cost entry, skill pickers,
  copy spells, shared-trainer lock and its copy button, menu items with the flag fallback and the tab
  pass-through (pattern: `world3d-menu-vendor-open.test.tsx`).
- MCP: authoring examples validate against the schema; the guide cites only real codes
  (`authoring-guides.test.ts` gains the `TRAINER_` prefix).
