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
- The trainer's type (class, mount, profession, pet), its greeting, and for a class trainer the class it serves.
- Making a new NPC a trainer with its own new trainer (new trainer id, type, greeting, spells).
- Detecting and loading an existing NPC's trainer; editing it as row-level changes.
- Giving an NPC whose trainer is shared its own copy of it.
- A "Trainer" tab in the NPC editor, right-click items, MCP support, docs, tests.
- Copying another NPC's trainer spells into this one.
- Showing, without editing, the spells an NPC also gets from the fork's older `npc_trainer` lists.

Out (for now):
- Translated greetings (`trainer_locale`).
- Editing the fork's `npc_trainer` lists (see "The older npc_trainer table").
- Authoring spells (`Spell.dbc`) or what a spell teaches; a trainer only lists spells that exist.
- Pointing several NPCs at one new trainer (copy covers reuse; sharing is only ever the database's).
- The vendor and game-event tables; trainer pets' talent trees; class-only gossip menus.

## Database

Checked against the fork's `acore_world` on 2026-10-09 (149 trainers, 1,046 default-trainer NPCs):

| Table | Key | Holds |
| --- | --- | --- |
| `creature_default_trainer` | `CreatureId` | which trainer an NPC uses: `CreatureId`, `TrainerId` |
| `trainer` | `Id` | `Id`, `Type` (0 class, 1 mount, 2 profession, 3 pet), `Requirement`, `Greeting` (mediumtext), `VerifiedBuild` |
| `trainer_spell` | `TrainerId`, `SpellId` | `MoneyCost`, `ReqSkillLine`, `ReqSkillRank`, `ReqAbility1..3` (prerequisite spells), `ReqLevel` (tinyint), `VerifiedBuild` |
| `trainer_locale` | `Id`, `locale` | translated greetings (not edited) |

- An NPC is a trainer through its `creature_default_trainer` row and bit 16 of `npcflag`.
- Several NPCs can point at one `trainer` row (class trainers share a list: one trainer serves up to 36 NPCs
  in this database; 50 trainers have a single NPC).
- `Requirement` is what limits who may use the trainer: the class id for a class trainer (`Type` 0; 1 to 32 here,
  since the fork has classes of its own) and for a pet trainer, a race for a mount trainer, a required spell for a
  profession trainer. The server treats 0 as no limit (`Trainer::IsTrainerValidForPlayer`), so a class trainer
  with 0 serves every class. The data has 0 for every type but class.
- `npcflag` sub-type bits on trainers of each type: class 16+32; mount and profession 16+64; pet 16 (a few have
  16+32). Other bits (gossip, vendor, repair, and so on) vary and are never touched.
- Trainer ids reach 900032 (the fork's classes); new ids are allocated above the highest in the database.
- Neither `creature_template` nor any other table has trainer columns.

### The older npc_trainer table

The fork also keeps `npc_trainer` (`ID`, `SpellID`, `MoneyCost`, `ReqSkillLine`, `ReqSkillRank`, `ReqLevel`,
`ReqSpell`; 4,934 rows). In this database its `ID`s are either shared lists numbered from 200001 (which hold
spells, positive `SpellID`) or NPC entries that include such a list through a negative `SpellID` (for example
`-200007`); 805 NPCs have both a default trainer and these includes. How the server merges them is the fork's
business, not this app's, so the editor shows that an NPC also uses them and leaves them exactly as they are:
the Trainer tab says "Also teaches the spells of N shared lists (the older npc_trainer table), which are not
edited here." New trainers never write to it.

## Model

`CustomNpc` (`src/core/entities/model.ts`) gains

```ts
trainer: trainerSchema.nullable().default(null)
trainer = { trainerId: int, type: enum(TRAINER_TYPES), requirement: int.min(0), greeting: string,
            spells: array(trainerSpell) }                // order is only the editor's display order
trainerSpell = { spell: int, cost: int.min(0), reqLevel: int.min(0).max(255), reqSkill: int.min(0),
                 reqSkillRank: int.min(0), reqSpells: array(int.positive()).max(3) }
```

- An NPC is a trainer when `trainer` is not null; there is no separate flag. Export sets or clears the
  trainer bit (16) of `npcflag` from that; every other bit stays as the database has it. A new NPC also gets
  the sub-type bit of its type (class 32; mount and profession 64; pet none).
- `requirement` is written as it is. The editor sets it from the class choice for class and pet trainers, resets
  it to 0 when the type changes, and leaves a mount or profession trainer's as it was read.
- `trainerId` is pinned like a guid: allocated once, when the trainer is made or copied, from above the
  database's highest `trainer.Id` and the project's. An existing NPC keeps the id it reads.
- `trainer = null` on an NPC that read a trainer means "no longer a trainer": export removes its
  `creature_default_trainer` row and clears the trainer bit. The trainer's own rows are left in the database
  (another NPC may use them; revert puts everything back).
- The default `null` keeps NPCs saved before this change as they were.

## Existing NPCs: detect, edit, copy

- `from-rows.ts`: `npcFromRows` reads the NPC's `creature_default_trainer` row, then its `trainer` row and
  `trainer_spell` rows, into `trainer`. `readOriginalRows` (`src/core/entities/existing.ts`) fetches them as
  new entries in `OriginalRows`, together with the NPC's own `npc_trainer` rows (to count the lists it also
  uses; they are kept only for that count and drift).
- The original rows stay in `origin.original`, so revert restores them.
- Shared trainer: `readExistingRows` (`src/main/entities/existing.ts`) counts the other NPCs whose
  `creature_default_trainer` names the same trainer, like `sharedLoot`. When it is more than zero the
  trainer part is locked (`EntityLock` gains `'trainer'`) and the Trainer tab shows a warning with
  **Give it its own copy**.
- Remove trainer on a shared trainer is allowed: it deletes only this NPC's own `creature_default_trainer` row
  and clears bit 16, and leaves the shared trainer's rows alone.
- Give it its own copy: allocates a new `trainerId`, keeps the spells, type, requirement and greeting, and
  takes `'trainer'` out of `origin.locked`, which is what makes the trainer the NPC's own. A trainer whose
  `trainerId` differs from the one read is always written as new rows; the trainer it was read from is never
  deleted or rewritten.
- Compile (`existing.ts`, `npcStatements`), only when the trainer differs from what was read (compared by
  value, as vendor stock is):
  - `creature_default_trainer` by `CreatureId`: delete, insert the new row (none when no longer a trainer).
  - `trainer` by `Id` and `trainer_spell` by `TrainerId`: delete the NPC's own trainer, insert the current rows.
    Columns the editor does not model (`VerifiedBuild`) are carried over from the original row with the same
    key (`SpellId` for spells).
  - A trainer that is still shared is never written (it is locked).
  - Opening an NPC never changes it.
- A project saved before this change has no trainer keys in `origin.original`: its trainer is left alone, and
  the Trainer tab says so, exactly as for vendor stock. A fork without the trainer tables is treated the
  same way (the tab says its database has no trainer tables).
- New NPCs: `compile.ts` writes the same rows next to its `creature_template` insert, and deletes its
  trainer's rows by id on every export so a removed spell does not linger.

## Validation (`validate.ts`)

A trainer an existing NPC was read with and has not changed is not checked: the database's own quirks are not the
author's to fix.

Errors (stop an export):
- `TRAINER_NO_ID`: no trainer id.
- `TRAINER_NO_SPELL`: a spell row with no spell.
- `TRAINER_DUPLICATE`: the same spell twice (primary key).
- `TRAINER_REQ_SPELL`: a prerequisite that is the spell itself.
- `TRAINER_ID_TAKEN`: a trainer id new to the project that another NPC in the database already uses (writing it
  would change that NPC's trainer, and the revert could not undo it). An id the NPC itself exported before is its
  own.
- `TRAINER_ID_DUPLICATE`: two NPCs in the project hold the same new trainer id.
- `TRAINER_SHARED`: an edit would be written over a trainer other NPCs use now, whatever the lock says (the lock
  is a snapshot taken when the NPC was opened, and an AI can drop it).

Warnings:
- `TRAINER_NO_CLASS`: a class trainer with no class chosen, so every class can train there.
- `TRAINER_EMPTY`: a trainer with no spells.
- `TRAINER_UNKNOWN_SPELL`: a spell not in the server's spell list (reuses the fight check's `knownSpell`).
- `TRAINER_NOT_READ`: trainer set on an existing NPC whose trainer was never read, so it is not written.
- `TRAINER_LOCKED`: an edit to a locked (shared) trainer, which is not written.

## UI

- `NpcEditor.tsx` gets a **Trainer** tab after **Vendor**, built like `VendorList.tsx`.
- Empty state: **Make this NPC a trainer**, which allocates the trainer id and opens the editor straight away on
  its type (class by default), class and greeting at the top.
- With a trainer: **Type** (select), **Class** (select, class and pet trainers: the stock classes by name, any
  other id as "Class N"), **Greeting** (text) at the top, then a spell table: spell picker (the existing spell
  search, with its rank and cost line), **Cost** in gold/silver/copper, **Required level**, **Skill** (picker
  over `skills.ts`, with a **Skill id** number field beside it for any other) and **Skill rank**, **Needs spells** (up to three spell pickers),
  **Remove**, and **Add spell**.
- **Copy spells from…** picks another NPC (existing or project) and replaces this trainer with its type, class,
  greeting and spells (never its id), asking first when the list is not empty (reusing `CopyStock`'s pattern).
- **Remove trainer** returns the NPC to not training, after confirmation when it has spells.
- A locked (shared) trainer shows its spells read-only, by name, with the count of other NPCs, **Give it its own
  copy** and **Remove trainer**.
- When the NPC also uses `npc_trainer` lists, the note described above.

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
  `guides.ts` (fields, the sharing note, the class rule, check codes) and `examples.ts` (a class trainer with
  two spells). No new tool; `allocate_ids` gains the kind `trainer`.
- Docs: `guides/npcs-and-objects.md` (a "Teaching spells" section), `reference/database-tables.md`
  (the tables), `guides/the-world.md` (the menu items), `guides/ai-mcp.md`.

## Testing

- Core: `from-rows` reads a trainer with its spells and counts the `npc_trainer` lists; `existing.ts` writes only
  when changed, replaces rows by key and carries `VerifiedBuild`; a shared trainer is locked and writes nothing;
  giving it its own copy points `creature_default_trainer` at a new id and leaves the shared rows alone; the
  trainer bit and a new NPC's sub-type bit are set and cleared with other bits kept; unread keys and a missing
  table leave the trainer alone; revert restores originals; new-NPC compile and re-export cleanup; every
  validation code.
- Main: the existing-entity loader returns trainer rows and the shared count (fake world DB); `allocate_ids`
  for `trainer`; validation uses the real spell list when loaded.
- Renderer: Trainer tab empty state, add/edit/remove spells, type, class and greeting, cost entry, skill
  pickers, copy spells, shared-trainer lock and its copy button, the `npc_trainer` note, menu items with the
  flag fallback and the tab pass-through (pattern: `world3d-menu-vendor-open.test.tsx`).
- MCP: authoring examples validate against the schema; the guide cites only real codes
  (`authoring-guides.test.ts` gains the `TRAINER_` prefix).
- An integration check against a real `acore_world` is run by hand before release (the fake DB cannot show
  that the server accepts the rows).
