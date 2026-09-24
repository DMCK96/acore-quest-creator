import type { CompiledScripts } from '../scripts/compile';
import { questTagPrefix } from '../scripts/tag';
import type { EntityContext } from './context';
import { NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE, type QuestEntities } from './model';

/**
 * New NPCs and objects to template and spawn rows, in the same shape as compiled scripts so one
 * renderer turns both into patch statements. Every key is pinned in the project, so each export
 * deletes and re-inserts the same rows; the columns quest scripting manages on a template are
 * carried over from the database so a re-insert never undoes them.
 */

type Row = Record<string, string>;

const GOSSIP_BIT = 1;
const QUEST_GIVER_BIT = 2;
/** `UNIT_CLASS_WARRIOR`: the plain melee class every simple NPC uses. */
const UNIT_CLASS = 1;
/** `GO_STATE_READY` and the fully drawn animation every placed object starts with. */
const GO_READY = 1;
const ANIM_FULL = 100;
const RANDOM_MOVEMENT = 1;

const text = (n: number): string => String(n);
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const num = (raw: string | null | undefined): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function compileEntities(input: {
  questId: number;
  entities: QuestEntities;
  /** Creature entries that start or end this quest. */
  givers: readonly number[];
  context: EntityContext;
}): CompiledScripts {
  const { questId, entities, givers, context } = input;
  const out: CompiledScripts = { inserts: {}, deletes: {}, updates: [], flags: [], warnings: [] };
  const insert = (table: string, row: Row): void => {
    (out.inserts[table] ??= []).push(row);
  };
  const creatureRows = new Map(context.creatures.map((r) => [num(r.entry), r]));
  const objectRows = new Map(context.gameobjects.map((r) => [num(r.entry), r]));

  const creatureGuids = new Set<number>();
  const objectGuids = new Set<number>();

  for (const npc of entities.npcs) {
    const existing = creatureRows.get(npc.entry);
    const npcflag =
      (npc.questGiver || givers.includes(npc.entry) ? QUEST_GIVER_BIT : 0) |
      (npc.gossip ? GOSSIP_BIT : 0) |
      (num(existing?.npcflag) & GOSSIP_BIT);
    insert('creature_template', {
      entry: text(npc.entry), name: npc.name, subname: npc.subname, minlevel: text(npc.minLevel), maxlevel: text(npc.maxLevel),
      faction: text(npc.faction), npcflag: text(npcflag), rank: text(RANK_VALUE[npc.rank]), type: text(NPC_TYPE_VALUE[npc.type]),
      HealthModifier: text(npc.healthModifier), DamageModifier: text(npc.damageModifier), unit_class: text(UNIT_CLASS),
      AIName: existing?.AIName ?? '', gossip_menu_id: existing?.gossip_menu_id ?? '0',
    });
    insert('creature_template_model', {
      CreatureID: text(npc.entry), Idx: '0', CreatureDisplayID: text(npc.displayId), DisplayScale: text(npc.scale), Probability: '1',
    });
    for (const spawn of npc.spawns) {
      creatureGuids.add(spawn.guid);
      insert('creature', {
        guid: text(spawn.guid), id1: text(npc.entry), map: text(spawn.map), spawnMask: '1', phaseMask: '1',
        position_x: text(spawn.x), position_y: text(spawn.y), position_z: text(spawn.z), orientation: text(spawn.o),
        spawntimesecs: text(spawn.respawnSecs), wander_distance: text(spawn.wander), MovementType: text(spawn.wander > 0 ? RANDOM_MOVEMENT : 0),
        Comment: `${questTagPrefix(questId)}npc${npc.entry}`,
      });
    }
  }

  for (const object of entities.objects) {
    const existing = objectRows.get(object.entry);
    const row: Row = {
      entry: text(object.entry), type: text(OBJECT_TYPE_VALUE[object.type]), displayId: text(object.displayId), name: object.name,
      size: text(object.size), AIName: existing?.AIName ?? '',
    };
    // A chest's loot is looked up by `Data1`; using its own entry keeps its loot rows its own.
    if (object.type === 'chest') row.Data1 = text(object.entry);
    insert('gameobject_template', row);
    for (const spawn of object.spawns) {
      objectGuids.add(spawn.guid);
      insert('gameobject', {
        guid: text(spawn.guid), id: text(object.entry), map: text(spawn.map), spawnMask: '1', phaseMask: '1',
        position_x: text(spawn.x), position_y: text(spawn.y), position_z: text(spawn.z), orientation: text(spawn.o),
        rotation0: '0', rotation1: '0', rotation2: text(round6(Math.sin(spawn.o / 2))), rotation3: text(round6(Math.cos(spawn.o / 2))),
        spawntimesecs: text(spawn.respawnSecs), animprogress: text(ANIM_FULL), state: text(GO_READY),
        Comment: `${questTagPrefix(questId)}obj${object.entry}`,
      });
    }
  }

  // Every key the project holds, plus spawns this quest placed before and the author since removed.
  // Only spawns of an NPC or object still in the project: like its template, the spawns of one the
  // project no longer has (or never had, in a fresh project) are left as they are.
  const tagOf = (kind: 'npc' | 'obj', entry: number): string => `${questTagPrefix(questId)}${kind}${entry}`;
  const npcTags = new Set(entities.npcs.map((n) => tagOf('npc', n.entry)));
  const objectTags = new Set(entities.objects.map((o) => tagOf('obj', o.entry)));
  for (const row of context.taggedCreatureSpawns) if (npcTags.has(row.Comment ?? '')) creatureGuids.add(num(row.guid));
  for (const row of context.taggedObjectSpawns) if (objectTags.has(row.Comment ?? '')) objectGuids.add(num(row.guid));
  const sorted = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);
  const add = (table: string, keys: Row[]): void => {
    if (keys.length > 0) out.deletes[table] = keys;
  };
  add('creature_template', sorted(entities.npcs.map((n) => n.entry)).map((e) => ({ entry: text(e) })));
  add('creature_template_model', sorted(entities.npcs.map((n) => n.entry)).map((e) => ({ CreatureID: text(e), Idx: '0' })));
  add('creature', sorted(creatureGuids).map((g) => ({ guid: text(g) })));
  add('gameobject_template', sorted(entities.objects.map((o) => o.entry)).map((e) => ({ entry: text(e) })));
  add('gameobject', sorted(objectGuids).map((g) => ({ guid: text(g) })));
  return out;
}
