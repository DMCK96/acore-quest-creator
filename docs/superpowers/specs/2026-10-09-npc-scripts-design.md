# NPC scripts: design

Part 4 of 4 of "expand NPC editing" (vendors, trainers, gossip, then scripts). It follows
[vendors](2026-10-09-npc-vendors-design.md), [trainers](2026-10-09-npc-trainers-design.md) and
[gossip](2026-10-09-npc-gossip-design.md), and builds on the quest scenes the app already has. Work is stacked:
`feat/npc-scripts` is cut from `feat/npc-gossip`.

## Goal

An author can give any NPC, new or existing, scripts of its own: "when this happens to me, and only when these hold,
do these steps in order". Today a scene belongs to a quest. Here it belongs to the NPC, so an NPC can talk, react,
spawn, walk or change its behaviour without a quest. A scene may name a quest, so an NPC can behave differently once
the player has finished one ("only after the quest is handed in", or a quest trigger such as accepted or handed in).

Scenes are compiled to SmartAI rows at export, as quest scenes are. The database's own scripts are not edited.

## Scope

In:
- A **Scripts** tab on the NPC editor: a list of scenes, each with a name, an optional quest, a trigger, gates and
  steps. The scene editor is the one quest scenes use (`SceneCard`, `TriggerEditor`, `GateEditor`, `StepEditor`).
- Scenes owned by the NPC (`CustomNpc.scenes`), for new NPCs and for existing NPCs the project has taken over.
- A scene that runs when a player picks an option of the NPC's own gossip menu (`gossipPicked`), the link spec 3
  left open.
- Compiling them at export with the same compiler as quest scenes, tagged to the NPC, with a revert that deletes them.
- Checks, the right-click menu, MCP support, docs and tests.

Out (for now):
- Editing or deleting SmartAI rows the database already has. They are counted and shown read-only; our rows avoid
  their ids.
- Scenes owned by objects or area triggers outside a quest. (A quest still owns those.)
- A raw SmartAI editor, C++ scripts (`ScriptName`), `creature_text` editing, conditions beyond the three gates.
- Fights and patrol-point actions. They stay on their own tabs; scenes and fights on one NPC never share an id.

## Database

Only `smart_scripts` rows are written (and `creature_template.AIName`, `creature_text`, `waypoints`, as the quest
compiler already does for its steps). Every row the app writes starts its `comment` with a tag so it can be found,
replaced and deleted without touching the database's own rows:

- Quest scenes: `AQC q<quest> s<n>` (unchanged).
- Fights, patrols: `AQC npc<entry> fight`, `AQC npc<entry> patrol` (unchanged).
- NPC scenes (new): `AQC npc<entry> s<n>`. The trigger row also carries the whole scene as JSON after ` #aqc=`, as
  quest scenes do, so an import into a fresh project gets the scenes back.

`npcRowOwner` gains a third kind, `'scene'`, matching `^s\d+(:|$)` after the NPC tag. The trailing space in the tag
keeps NPC 1200 from claiming 12000's rows.

Facts the compiler must respect (all of them already hold for quest scenes):
- A row is keyed `(entryorguid, source_type, id, link)`. For a creature, `entryorguid` is the entry and `source_type`
  is 0. Our `id`s are chosen above every id any other row of that NPC uses (the database's, the fights', the quest
  scenes'), through the same allocator.
- `creature_template.AIName` must be `SmartAI` for the rows to run. The compiler sets it when it is empty. If it is
  another AI, or `ScriptName` is set, the NPC runs something else and the scenes are **locked** (see Existing NPCs).
- An escort (`startEscort`) writes `waypoints` rows under a path id the allocator takes above the database's.
- A `gossipOption` trigger adds an option to the NPC's root menu on the next free option id, or makes a menu if the
  NPC has none. With a project gossip tree it hangs off the tree's root (spec 3 already passes the tree to the
  compiler). A `gossipPicked` trigger adds no option; it attaches to one the tree already has.

## Model

`CustomNpc` gains `scenes: NpcScene[]`, default `[]`. Old projects load without the key.

```
NpcScene = {
  id: 's<n>',            // unique within the NPC; the next one is past the highest in use
  name: string,
  questId: int >= 0,     // 0 = no quest
  trigger: SceneTrigger | { kind: 'gossipPicked', menuId: int, optionId: int },
  gates: SceneGate[],    // a quest gate with questId 0 means this scene's quest
  steps: SceneStep[],
}
```

It is the quest scene minus `owner` (the owner is always this NPC) plus `questId` and the `gossipPicked` trigger.
`sceneSchema` is split into the part both share; quest scenes do not change shape.

- Triggers an NPC scene may use: `talkedTo`, `gossipOption`, `gossipPicked`, `spellHit`, `dies`, `playerNear`,
  `signal`, `summoned`, `waypointReached` (names an escort scene of this NPC), and, with a quest, `questAccepted` and
  `questHandedIn`. `enterArea` belongs to area triggers and is not offered.
- Steps: all of them. `credit`, `eventCredit` and `failQuest` act on a quest and need `questId`.
- `questId` may name a project quest or a database quest. The editor offers the project's quests, and takes an id.
- Cap: 32 scenes per NPC.

A scene's `gossipPicked` option `(menuId, optionId)` must be an option of this NPC's own tree that is not locked and
not kept (spec 3). The compiler writes an event 62 (`gossip select`) row for it. It writes nothing in the gossip
tables; the tree does.

## Existing NPCs

An existing NPC the project has taken over may have scenes. They are written the same way, as new rows with our tag,
beside the database's rows, which are never edited or deleted.

- **Read**: the NPC's `smart_scripts` rows that are not ours are counted (`origin.databaseScripts`) and the tab says
  so ("The database already runs N scripts on this NPC; they are not edited here"). They are not decompiled.
- **Locked**: when `AIName` is neither empty nor `SmartAI`, or `ScriptName` is set, the NPC's behaviour belongs to
  something else. `origin.locked` gains `scenes`: the tab shows the scenes read-only, the compiler writes none and the
  checks warn.
- **Our own scripts are not "kept"**: spec 3 marks a gossip option `kept` when an event 62 script names it. A script
  tagged `AQC npc<entry> s<n>` is ours and is ignored when deciding that, so an option a scene hangs off is not
  frozen by it. A script of any other tag, or none, still freezes the option.
- **Put back as the database has it** drops the NPC's scenes with the rest of its edits. The revert patch of an export
  deletes the rows the export wrote.
- **Cleanup**: every NPC in the project goes to the compiler, so rows of a scene since removed are found by tag and
  deleted. An NPC taken out of the project entirely is not cleaned up (the same as its fight).

## Validation (`src/core/scripts/validate.ts`, wired from `src/main/api/checks.ts`)

The scene checks quest scenes already have (a step with nothing to do, an unknown spell, a missing owner, a quest
objective with no credit, a trigger with no player for a step that needs one) run for NPC scenes, with the owner
fixed. New codes:

Errors:
- `NPC_SCENE_QUEST_NEEDED`: the scene has a quest-bound trigger, step or "this quest" gate and no quest.
- `NPC_SCENE_OPTION_GONE`: a `gossipPicked` option is not in the NPC's tree.
- `NPC_SCENE_OPTION_LOCKED`: the option is in a locked menu, is kept, or the menu is not the NPC's own.
- `NPC_SCENE_ESCORT`: `waypointReached` names a scene that is not an escort of this NPC.
- `NPC_SCENE_ID_DUPLICATE`: two scenes of one NPC share an id.
- `NPC_SCENE_LIMIT`: more than 32 scenes.

Warnings:
- `NPC_SCENES_LOCKED`: the NPC runs another AI or a C++ script, so its scenes are not written.
- `NPC_SCENE_QUEST_UNKNOWN`: the quest is neither in the project nor the database.
- `NPC_SCENE_NO_STEPS`: a scene with a trigger and nothing to do.

A gossip option that a scene hangs off cannot be removed from the tree: the tree's own check
(`GOSSIP_KEPT_REMOVED` for database scripts) gains the same refusal for ours, as `NPC_SCENE_OPTION_GONE`.

## UI

- **Scripts tab** (ninth, after Gossip). The list of scenes as cards with Add scene, Remove, Duplicate. A scene card
  is the quest scene card with two changes: a **Quest** field at the top (None, a project quest, or an id), and a
  trigger list without the triggers the NPC cannot use. Quest-bound triggers and steps are offered always; they show
  a note ("needs a quest") until one is chosen.
- A `gossipPicked` trigger shows a menu-and-option picker over the NPC's own tree. If the NPC has no tree, the
  picker says so and offers **Give this NPC a gossip menu**, which goes to the Gossip tab.
- A locked NPC shows the scenes read-only and says why.
- **Gossip tab**: an option a scene hangs off shows "Runs the scene *name*", with a button to the Scripts tab, and
  cannot be removed.
- Plain language throughout: "scene", "trigger", "step", not SmartAI terms.

## Right-click menu

A new section after Gossip, for NPCs only: **Add script…** (or **Edit scripts…** with the count of scenes as its
hint), opening the Scripts tab. An existing NPC needs the world database to be read, like the other items.
`NpcSpawn` gains `scenes: { has, count }`.

## MCP and docs

- `upsert_entity` for an NPC accepts `scenes`. A new authoring model `npc-scripts` (schema, guide, example) is added,
  as `gossip` was, because the NPC guide is full; the NPC guide gets a pointer bullet. The guide covers: the scene
  shape, which triggers and steps need a quest, `gossipPicked`, how ids and tags work, locking, and that database
  scripts are never edited.
- `allocate_ids` needs no new kind: scene ids are local, and everything else comes from the compiler.
- Site docs: a "Scripts" section in the NPC guide, the World page, the database tables reference (`smart_scripts` and
  the tag), and the AI page.

## Testing

- `npc-scenes` model: parse, defaults, an old NPC without the key, quest-bound rules.
- Tag: round trip, `npcRowOwner` for scene rows, the trailing-space rule.
- Compiler: one NPC scene per trigger kind, ids clear of the database's rows and the fights', rows deleted by tag when
  a scene is removed, an existing NPC with SmartAI rows of its own left alone, AIName set only when empty, locked NPC
  writes nothing, a quest scene and an NPC scene on one NPC never share an id.
- `gossipPicked`: event 62 row names the tree's menu and option, no gossip rows written by the scene, and the option
  is not read back `kept`.
- Validation: each code, with the case that does not raise it.
- UI: the tab, the quest field, the option picker, the locked and read-only states, the Gossip tab note.
- Menu section, subject, MCP tools and authoring guide.
- Real database (integration, read-only): for the NPCs with the most SmartAI rows, compile a scene and check no key
  collides with a database row; no `smart_scripts.comment` in the database starts with `AQC npc`; every database
  gossip-select script is still read as `kept`; a project round trip (compile, then read the tag back) returns the
  same scene.

## Review focus

The inputs most likely to bite, to be pinned by tests in the plan:
- An existing NPC with hundreds of SmartAI rows and linked chains: our ids must not land inside a chain.
- An NPC with `AIName` of another AI, or a `ScriptName`: nothing written, a clear warning.
- Removing a scene, or the last scene: its rows deleted, `AIName` left as it was.
- A scene whose quest is later deleted from the project: still compiles from its id; the warning only.
- A `gossipPicked` option the author removes, copies, or whose menu becomes locked after "Give it its own copy".
- Two scenes with the same trigger on one NPC (both run; the order is the list order).
- Escort scenes: path ids shared with the database's and the quest scenes'.
- The same NPC edited by a fight, a patrol and scenes at once: one allocator, no shared id, list or text group.
