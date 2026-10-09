# NPC gossip: design

Part 3 of 4 of "expand NPC editing" (vendors, trainers, gossip, then scripts). Scripts get their own spec (4):
scenes owned by an NPC rather than by a quest is a different kind of change from this data editor.
Vendors and trainers are in [2026-10-09-npc-vendors-design.md](2026-10-09-npc-vendors-design.md) and
[2026-10-09-npc-trainers-design.md](2026-10-09-npc-trainers-design.md); this design follows their pattern and
reuses their pieces.

## Goal

An author can give any NPC, new or existing, a gossip menu: a greeting and options, where each option closes the
window, opens another menu, or opens a service window (vendor, trainer, bank, inn, and so on). If an existing NPC
already has a menu, opening it shows the menu, ready to edit. A menu that other NPCs share is never changed by
accident: the editor locks it and offers to give this NPC its own copy.

## Scope

In:
- A menu tree: the NPC's root menu and the menus its options open, each with its greeting and options.
- A greeting: its weighted text variants (up to 8), each with a text and an optional female text.
- Options: icon, text, and what it does (close, open a menu, or a named service).
- Reading an existing NPC's tree, editing it as row-level changes, and giving it its own copy of shared menus.
- A "Gossip" tab, right-click items, MCP support, docs, tests.
- Copying another NPC's menu tree into this one.

Out (for now):
- Scripts: what happens when a player picks an option (SmartAI `gossip select` events, quest scenes). Options tied
  to one are kept and shown read-only. Spec 4.
- Conditions on menus and options (who sees what); they are kept, never edited.
- Translations (`npc_text.BroadcastTextID*`, `gossip_menu_option.OptionBroadcastTextID`); an edited text clears them.
- Pay-to-pick and code-entry boxes (`BoxCoded`, `BoxMoney`, `BoxText`), and map markers (`ActionPoiID`): carried over
  as the database has them, not editable.
- Gossip on objects (`gameobject_template.Data3`); a menu an object uses counts as shared.

## Database

Checked against the fork's `acore_world` on 2026-10-09 (6,336 menus, 4,889 options, 8,609 texts):

| Table | Key | Holds |
| --- | --- | --- |
| `creature_template` | `entry` | `gossip_menu_id` (the root menu); `npcflag` bit 1 makes the NPC talkable |
| `gossip_menu` | `MenuID`, `TextID` | which text a menu greets with (one row, or several chosen by conditions) |
| `npc_text` | `ID` | up to 8 variants: `text{i}_0`, `text{i}_1` (female), `Probability{i}`, `BroadcastTextID{i}`, `lang{i}`, `em{i}_0..5` |
| `gossip_menu_option` | `MenuID`, `OptionID` | `OptionIcon`, `OptionText`, `OptionBroadcastTextID`, `OptionType`, `OptionNpcFlag`, `ActionMenuID`, `ActionPoiID`, `Box*` |
| `conditions` | (many) | source types 14 (a menu's text) and 15 (an option); not edited |

- An option shows only to an NPC whose `npcflag` has `OptionNpcFlag`. A service option needs both its
  `OptionType` and `OptionNpcFlag`; the pairs in the data are:

  | Service | `OptionType` | `OptionNpcFlag` | Icon |
  | --- | --- | --- | --- |
  | Close or plain talk | 1 | 1 | 0 |
  | Vendor | 3 | 128 | 1 |
  | Flight master | 4 | 8192 | 2 |
  | Trainer | 5 | 16 | 3 |
  | Innkeeper (make this home) | 8 | 65536 | 5 |
  | Banker | 9 | 131072 | 6 |
  | Petitions | 10 | 262144 | 7 |
  | Tabard designer | 11 | 524288 | 8 |
  | Battlemaster | 12 | 1048576 | 9 |
  | Auctioneer | 13 | 2097152 | 6 |
  | Stable master | 14 | 4194304 | 0 |
  | Armorer | 15 | 4096 | 1 |
  | Unlearn talents | 16 | 16 | 0 |

  Any other pair in the database (dual specialization, scripted types) is kept as read and shown as
  "Other (type N, flag M)".
- A plain "talk" option has type 1 and flag 1. It does something only through `ActionMenuID` (2,688 of the 3,409
  open another menu) or through a SmartAI script; one with neither just closes the window.
- 238 menus are used by more than one NPC (one by 107); 230 objects use a menu; 401 texts are used by more than
  one menu.
- 710 menus have more than one text row, chosen by conditions (1,379 conditions on 573 menus); 4,240 conditions
  sit on options of 1,089 menus; 986 SmartAI `gossip select` rows (event 62, `event_param1` the menu,
  `event_param2` the option) belong to 546 NPCs.
- `OptionID` starts at 0 in most menus and is mostly contiguous, but not always, and conditions and scripts
  refer to it: an option's id never changes.
- Ids reach 932534 for menus and 9780012 for texts (one text sits at 16777215 and is ignored when allocating).
- 4,488 options and many texts carry a `BroadcastTextID`: other-locale clients show that text instead of ours.

## Model

`CustomNpc` (`src/core/entities/model.ts`) gains

```ts
gossipMenu: gossipTreeSchema.nullable().default(null)   // `gossip` is already the Can be talked to flag
gossipTree = { menus: array(gossipMenu).min(1) }        // menus[0] is the NPC's root menu
gossipMenu = { menuId: int, textId: int, greeting: array(textVariant).min(1).max(8),
               options: array(gossipOption), locked: boolean }
textVariant = { text: string, textFemale: string, probability: number.min(0) }
gossipOption = { optionId: int, icon: int.min(0), text: string, action: gossipAction, kept: boolean }
gossipAction = { kind: 'close' } | { kind: 'menu', menuId: int.positive() }
             | { kind: 'service', type: int, npcFlag: int }
```

- `gossipMenu` is not null when the NPC has a gossip menu; export sets `creature_template.gossip_menu_id` to the root
  menu's id. Bit 1 of `npcflag` stays the **Can be talked to** checkbox's alone (`GOSSIP_NOT_TALKABLE` warns when a
  menu has it off); a new NPC is also given the bits its service options need. `null` clears `gossip_menu_id`.
  Every other bit stays as the database has it.
- `locked` is read-only data: the menu is shared with other NPCs or objects, or has more than one text row, or its
  text is used by another menu. A locked menu is never written. Taking a copy gives it new `menuId` and `textId`
  and clears `locked`, as a trainer's copy does.
- `kept` marks an option the database ties to a condition or a script: it cannot be removed, its action cannot be
  changed, and its id never moves; its text and icon can be edited.
- `menuId`, `textId` and every `optionId` are pinned: allocated once, or read. A new option gets one above the
  menu's highest `optionId`, never a freed one.
- An option with action `menu` names a menu id: one of this NPC's `menus`, or any menu the database has (kept as a
  bare id, not loaded).
- The default `null` keeps NPCs saved before this change as they were.

## Existing NPCs: detect, edit, copy

- `readOriginalRows` (`src/core/entities/existing.ts`) fetches, for the root menu and every menu its options open
  (followed transitively, each loaded once, at most 24 menus): the `gossip_menu`, `gossip_menu_option` and
  `npc_text` rows, and the keys needed for `kept` and `locked`: the `conditions` rows of source types 14 and 15 for
  those menus, the `event 62` SmartAI rows naming them, and the other users of each menu and text
  (`creature_template.gossip_menu_id`, `gameobject_template.Data3` of type 2, other `gossip_menu` rows).
  Each key is present only when its table exists; a project saved before this change has none and its gossip is
  left alone (the tab says so), exactly as for vendors and trainers.
- `npcFromRows` builds `gossip`: menus in discovery order, options by `OptionID`, the greeting from the menu's
  single text row (a menu with several text rows reads its first and is `locked`). An option is `kept` when a
  condition (type 15) or a `gossip select` script names it. A menu is `locked` as described under Model.
- Compile (`npcStatements`), only for menus that changed from what was read, and never for a locked menu:
  - `gossip_menu`: delete the keys `(MenuID, TextID)` it read or holds, insert its row.
  - `npc_text`: delete and insert by `ID` the text it owns, carrying every column the editor does not model; an
    edited text clears that variant's `BroadcastTextID`; variants beyond the greeting's length are zeroed.
  - `gossip_menu_option`: delete the keys `(MenuID, OptionID)` it read or holds, insert the rows, carrying the
    columns it does not model (`ActionPoiID`, `Box*`, `VerifiedBuild`); an edited option clears its
    `OptionBroadcastTextID`. Options are keyed one by one, never by whole menu, so options another writer added
    to the same menu (a quest scene) are not deleted.
  - `creature_template`: `gossip_menu_id` and bit 1, only when the root menu or the link changed.
  - `conditions` and `smart_scripts` are never written.
- Opening an NPC never changes it; the revert restores the originals.
- Give it its own copy (per menu, or **Copy the whole menu tree** for the NPC): allocates new menu and text ids,
  keeps the content, clears `locked`; options that opened a copied menu are repointed at its copy. A copy is all new rows:
  what the editor does not model (map markers, boxes, translations) is not copied. A menu only a locked menu opens is
  locked too (everyone who uses the first uses it). The shared menus are never deleted or rewritten. A `kept` option stays `kept` in the copy but its condition and script do
  not follow it (they name the old menu): the copy drops `kept` and the tab says so before copying.
- New NPCs: `compile.ts` writes the same rows, and deletes by key on every export what a past export wrote for the
  NPC's menus (found through `creature_template.gossip_menu_id` and the option ids the database holds for menus
  only project NPCs use), so a removed option does not linger. It never deletes a menu or text NPCs outside the
  project use.

## Validation (`validate.ts`)

Errors (stop an export):
- `GOSSIP_KEPT_REMOVED`: an option the database ties to a condition or a script, or a menu holding one, is no longer there.
- `GOSSIP_NO_ID`: a menu or text with no id (`<= 0`).
- `GOSSIP_OPTION_NO_TEXT`: an option with no text.
- `GOSSIP_NO_GREETING`: every greeting variant has probability 0, so none could be chosen.
- `GOSSIP_ID_TAKEN`: a new menu id that another creature or an object already uses as its menu, or a new text id
  that another menu uses. (A sub-menu's id that merely has rows is not flagged: rows alone cannot be told from the
  NPC's own earlier export.)
- `GOSSIP_ID_DUPLICATE`: two NPCs in the project hold the same new menu or text id.
- `GOSSIP_SHARED`: an edit would be written over a menu other NPCs or objects use now, whatever the lock says.

Warnings:
- `GOSSIP_EMPTY_GREETING`: a greeting variant with no text.
- `GOSSIP_UNKNOWN_MENU`: an option opens a menu that neither the database nor the NPC's menus have.
- `GOSSIP_UNREACHABLE`: a menu no option of the root reaches.
- `GOSSIP_SERVICE_FLAG`: a service option for a service the NPC lacks the flag for (a vendor option on a non-vendor
  NPC, which would never show).
- `GOSSIP_SCENE`: a quest scene with a gossip option trigger owned by an NPC that has a menu here; the scene writes
  its own menu and option and does not know this one (resolved when scenes move to NPCs, spec 4).
- `GOSSIP_LOCKED`: an edit to a locked menu, which is not written.
- `GOSSIP_NOT_TALKABLE`: the NPC has a menu but **Can be talked to** is off, so players cannot open it.
- `GOSSIP_NOT_READ`: gossip set on an existing NPC whose gossip was never read, so it is not written.

An existing menu left as read is not checked: the database's own quirks are not the author's to fix.

## UI

- `NpcEditor.tsx` gets a **Gossip** tab after **Trainer**.
- Empty state: **Give this NPC a gossip menu**, which allocates a menu and a text id, adds a greeting variant and
  turns **Can be talked to** on.
- With a menu: a list of the NPC's menus (root first, then each menu its options open, with its first line as the
  label), and for the selected menu:
  - **Greeting**: one row per variant (**Text**, **Female text** when used, **Chance**), **Add variant**,
    **Remove**. A greeting the database chooses by condition shows read-only.
  - **Options**: one row per option, with **Icon**, **Text**, and **Does**: **Closes the window**, **Opens
    menu…** (pick one of this NPC's menus, **New menu…**, or a menu id), or a service by name
    (**Vendor**, **Trainer**, **Flight master**, and the rest of the table, or "Other (type N, flag M)"). Picking
    a service sets its icon when the icon is still 0. **Add option**, **Remove**, **Up**/**Down** (order is
    display order only; ids do not move). A `kept` option shows why ("has a condition", "runs a script") and has
    no **Remove**.
- A locked menu shows read-only with the count of other NPCs and objects that use it, **Give it its own copy**
  and **Copy the whole menu tree**.
- **Remove gossip menu** returns the NPC to having none, after confirmation when it has options.
- **Copy menu from…** picks another NPC (existing or project) and replaces this NPC's whole tree with a copy of
  its, with new ids, asking first when this NPC has one.
- A service option for a service the NPC lacks says so, with **Make it a vendor** / **Make it a trainer** buttons
  that open those tabs.

## Right-click menu

New section `src/renderer/world3d/menu/sections/gossip.ts`, registered after `trainer`, group `world`:
- NPC without a menu: **Add gossip menu…**
- NPC with a menu: **Edit gossip menu…**, with the option count as a hint when the project holds it.
- An unopened database NPC is told apart by its `gossip_menu_id`, which the spawn view query already reads from
  `creature_template` and now also selects as `gossipMenuId`.
Both open the editor on the Gossip tab (`MenuEditorTab` gains `'gossip'`). They are edits, so they are disabled
while an AI write runs.

## MCP and docs

- The authoring model gains `gossip`, so `new_entity`, `upsert_entity` and the `npc` JSON schema carry it;
  `guides.ts` (fields, services table, sharing and `kept`, check codes) and `examples.ts` (an innkeeper-style menu
  with two options). `allocate_ids` gains the kinds `gossipMenu` and `gossipText`.
- Docs: `guides/npcs-and-objects.md` ("Talking"), `reference/database-tables.md`, `guides/the-world.md`,
  `guides/ai-mcp.md`.

## Testing

- Core: `from-rows` reads a tree (root, sub-menus, cycles, the 24-menu cap), marks `kept` and `locked`;
  `existing.ts` writes only changed, unlocked menus, keys options one by one so options another writer added
  survive, clears broadcast ids on edited text, carries unmodelled columns, repoints copied menus, and sets
  `gossip_menu_id` and bit 1; unread keys and missing tables leave gossip alone; revert restores originals; new-NPC
  compile and re-export cleanup; every validation code.
- Main: the loader returns the tree rows and users (fake DB); allocation of both kinds over dangling references;
  live user counts for `GOSSIP_SHARED` and `GOSSIP_ID_TAKEN`; an export renders against the real columns.
- Renderer: tab empty state, greeting variants, options, actions, services and their icons, sub-menus,
  `kept` options, locked menu and copies, menu items with the `gossipMenuId` fallback and the tab pass-through.
- MCP: examples validate; the guide cites only real codes.
- Integration against `acore_world`: read the tree of every creature menu (reads clean, writes nothing, renders a
  copy against the real columns), as the trainer sweep does.
