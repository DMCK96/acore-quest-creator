import { isDeepStrictEqual } from 'node:util';
import { fieldById } from '../../core/registry';
import { moduleById, ownerOf } from '../../core/modules/catalog';
import type { ModuleId } from '../../core/modules/model';
import { groupsOf, movementsOf, respawnsOf, spawnEventsOf, type WorldLayer, type WorldRouteEdit } from '../../core/world/layer';
import type { HistoryPart, QuestEdit, StepPlace, StepSummary } from '../../shared/history';
import type { HistoryStep } from './history';

const TITLE_FIELD = 'quest_template.LogTitle';

type QuestPart = Extract<HistoryPart, { kind: 'quest' }>;
type WorldPart = Extract<HistoryPart, { kind: 'world' }>;
type Described = { label: string; where: StepPlace | null };

const titleOf = (questId: number, edit: QuestEdit | null): string => {
  const title = edit?.aggregate.values[TITLE_FIELD];
  return typeof title === 'string' && title.trim() !== '' ? title : `quest ${questId}`;
};

/** A field by its own label, else the module that edits it (the scripts, the NPCs), else nothing */
const fieldName = (fieldId: string): string | null => {
  const owner = ownerOf(fieldId);
  const field = fieldById(fieldId);
  if (field) return field.label;
  if (owner && owner !== 'header' && owner !== 'hidden') return moduleById(owner).label;
  return null;
};

const moduleOf = (fieldId: string): ModuleId | 'header' | 'hidden' | undefined => ownerOf(fieldId);

function describeQuests(parts: QuestPart[]): Described {
  const added = parts.filter((p) => p.before === null && p.after !== null);
  if (added.length > 1) return { label: `Added a chain of ${added.length} quests`, where: { questId: added[0]!.questId } };
  const part = parts[0]!;
  if (part.before === null) {
    const label = part.after?.isNew ? `New quest ${part.questId}` : `Added ${titleOf(part.questId, part.after)}`;
    return { label, where: { questId: part.questId } };
  }
  if (part.after === null) return { label: `Removed ${titleOf(part.questId, part.before)}`, where: null };
  const title = titleOf(part.questId, part.after);
  const a = part.before.aggregate.values;
  const b = part.after.aggregate.values;
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !isDeepStrictEqual(a[k], b[k]));
  const owners = new Set(changed.map(moduleOf));
  const only = owners.size === 1 ? [...owners][0] : undefined;
  const module = only && only !== 'header' && only !== 'hidden' ? only : undefined;
  const where: StepPlace = module ? { questId: part.questId, module } : { questId: part.questId };
  if (changed.length === 1) {
    const name = fieldName(changed[0]!);
    if (name) return { label: `${name} of ${title}`, where };
  }
  if (module) return { label: `${moduleById(module).label} of ${title}`, where };
  return { label: `Edit to ${title}`, where };
}

interface WorldChange {
  text: string;
  where: StepPlace | null;
}

/** What changed between two world layers, entry by entry, each with where it is */
function worldChanges(before: WorldLayer, after: WorldLayer): WorldChange[] {
  const out: WorldChange[] = [];
  const keyed = <T,>(list: T[], key: (t: T) => string) => new Map(list.map((t) => [key(t), t]));
  const spawnKey = (s: { kind: string; guid: number }) => `${s.kind}:${s.guid}`;

  const spawnsBefore = keyed(before.spawns, spawnKey);
  const spawnsAfter = keyed(after.spawns, spawnKey);
  for (const [key, s] of spawnsAfter) {
    if (isDeepStrictEqual(spawnsBefore.get(key), s)) continue;
    out.push({ text: `Moved ${s.name}`, where: { map: s.map, x: s.current.x, y: s.current.y, z: s.current.z, spawn: { kind: s.kind, guid: s.guid } } });
  }
  for (const [key, s] of spawnsBefore) {
    if (spawnsAfter.has(key)) continue;
    out.push({ text: `Reverted ${s.name}`, where: { map: s.map, x: s.original.x, y: s.original.y, z: s.original.z, spawn: { kind: s.kind, guid: s.guid } } });
  }

  const addedBefore = keyed(before.added, spawnKey);
  const addedAfter = keyed(after.added, spawnKey);
  for (const [key, s] of addedAfter) {
    const was = addedBefore.get(key);
    if (isDeepStrictEqual(was, s)) continue;
    const at = s.placement;
    // A spawn placed before says what about it changed
    const what = !was ? `Placed ${s.name}`
      : !isDeepStrictEqual(was.placement, s.placement) ? `Moved ${s.name}`
      : was.respawnSecs !== s.respawnSecs ? `Respawn time of ${s.name}`
      : !isDeepStrictEqual(was.events, s.events) ? `Events of ${s.name}`
      : `Changed ${s.name}`;
    out.push({ text: what, where: { map: s.map, x: at.x, y: at.y, z: at.z, spawn: { kind: s.kind, guid: s.guid } } });
  }
  for (const [key, s] of addedBefore) {
    if (addedAfter.has(key)) continue;
    out.push({ text: `Removed placed ${s.name}`, where: { map: s.map, x: s.placement.x, y: s.placement.y, z: s.placement.z } });
  }

  const routesBefore = keyed(before.routes, (r) => String(r.pathId));
  const routesAfter = keyed(after.routes, (r) => String(r.pathId));
  // A route by the NPC that walks it: the one read at its first edit, else one whose movement walks it
  const routeName = (r: WorldRouteEdit): string => {
    const name = r.name ?? [...movementsOf(after), ...movementsOf(before)].find((m) => m.current.pathId === r.pathId)?.name;
    return name ? `route of ${name}` : `route ${r.pathId}`;
  };
  const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
  for (const [key, r] of routesAfter) {
    if (isDeepStrictEqual(routesBefore.get(key), r)) continue;
    out.push({ text: upper(routeName(r)), where: null });
  }
  for (const [key, r] of routesBefore) if (!routesAfter.has(key)) out.push({ text: `Reverted ${routeName(r)}`, where: null });

  const movesBefore = keyed(movementsOf(before), (m) => String(m.guid));
  const movesAfter = keyed(movementsOf(after), (m) => String(m.guid));
  for (const [key, m] of movesAfter) {
    if (isDeepStrictEqual(movesBefore.get(key), m)) continue;
    out.push({ text: `Movement of ${m.name}`, where: null });
  }
  for (const [key, m] of movesBefore) if (!movesAfter.has(key)) out.push({ text: `Reverted movement of ${m.name}`, where: null });

  const respawnKey = (r: { kind: string; guid: number }) => `${r.kind}:${r.guid}`;
  const respawnsBefore = keyed(respawnsOf(before), respawnKey);
  const respawnsAfter = keyed(respawnsOf(after), respawnKey);
  for (const [key, r] of respawnsAfter) {
    if (isDeepStrictEqual(respawnsBefore.get(key), r)) continue;
    out.push({ text: `Respawn time of ${r.name}`, where: null });
  }
  for (const [key, r] of respawnsBefore) if (!respawnsAfter.has(key)) out.push({ text: `Reverted respawn time of ${r.name}`, where: null });

  const eventsBefore = keyed(spawnEventsOf(before), (e) => String(e.guid));
  const eventsAfter = keyed(spawnEventsOf(after), (e) => String(e.guid));
  for (const [key, e] of eventsAfter) {
    if (isDeepStrictEqual(eventsBefore.get(key), e)) continue;
    out.push({ text: `Events of ${e.name}`, where: null });
  }
  for (const [key, e] of eventsBefore) if (!eventsAfter.has(key)) out.push({ text: `Reverted events of ${e.name}`, where: null });

  const groupsBefore = keyed(groupsOf(before), (g) => String(g.id));
  const groupsAfter = keyed(groupsOf(after), (g) => String(g.id));
  for (const [key, g] of groupsAfter) {
    if (isDeepStrictEqual(groupsBefore.get(key), g)) continue;
    out.push({ text: `${g.removed ? 'Deleted' : 'Saved'} spawn group ${g.name}`, where: null });
  }
  for (const [key, g] of groupsBefore) if (!groupsAfter.has(key)) out.push({ text: `Removed spawn group ${g.name}`, where: null });
  return out;
}

function describeWorld(part: WorldPart): Described {
  const changes = worldChanges(part.before, part.after);
  if (changes.length === 1) return { label: changes[0]!.text, where: changes[0]!.where };
  return { label: `World: ${changes.length} changes`, where: changes.find((c) => c.where)?.where ?? null };
}

type EntitiesPart = Extract<HistoryPart, { kind: 'entities' }>;
type AnyEntity = { entry: number; name: string; spawns?: { guid: number; map: number; x: number; y: number; z: number }[] };

/** What changed among the project's NPCs, objects and items, entity by entity, each with where it stands */
function entityChanges(before: EntitiesPart['before'], after: EntitiesPart['after']): WorldChange[] {
  const out: WorldChange[] = [];
  const kinds = [
    ['npcs', 'NPC', 'creature'],
    ['objects', 'object', 'gameobject'],
    ['items', 'item', null],
  ] as const;
  for (const [key, word, spawnKind] of kinds) {
    const was = new Map((before[key] as AnyEntity[]).map((e) => [e.entry, e]));
    const now = new Map((after[key] as AnyEntity[]).map((e) => [e.entry, e]));
    const placeOf = (e: AnyEntity): StepPlace | null => {
      const s = e.spawns?.[0];
      return s && spawnKind ? { map: s.map, x: s.x, y: s.y, z: s.z, spawn: { kind: spawnKind, guid: s.guid } } : null;
    };
    const named = (e: AnyEntity): string => e.name.trim();
    for (const [entry, e] of now) {
      const old = was.get(entry);
      if (!old) {
        out.push({ text: named(e) ? `New ${word} ${named(e)}` : `New ${word}`, where: placeOf(e) });
        continue;
      }
      if (isDeepStrictEqual(old, e)) continue;
      const name = named(e) || `${word} ${entry}`;
      const fields = [...new Set([...Object.keys(old), ...Object.keys(e)])].filter((k) => !isDeepStrictEqual((old as Record<string, unknown>)[k], (e as Record<string, unknown>)[k]));
      let text = `Edit to ${name}`;
      if (fields.length === 1 && fields[0] === 'spawns') {
        const a = old.spawns ?? [];
        const b = e.spawns ?? [];
        if (b.length === a.length + 1) text = `Placed ${name}`;
        else if (b.length === a.length - 1) text = `Removed a spawn of ${name}`;
        else if (b.length === a.length) {
          const changed = b.flatMap((s, i) => (isDeepStrictEqual(s, a[i]) ? [] : [[a[i] as Record<string, unknown>, s as Record<string, unknown>] as const]));
          // One spawn changed: only its patrol is a patrol edit, anything else about it a move
          const patrolOnly = changed.length === 1 && [...Object.keys(changed[0]![0]), ...Object.keys(changed[0]![1])].every((k) => k === 'patrol' || isDeepStrictEqual(changed[0]![0][k], changed[0]![1][k]));
          text = changed.length !== 1 ? `Spawns of ${name}` : patrolOnly ? `Patrol of ${name}` : `Moved ${name}`;
        } else text = `Spawns of ${name}`;
      } else if (fields.length === 1 && fields[0] === 'loot') text = `Loot of ${name}`;
      else if (fields.length === 1 && fields[0] === 'name') text = `Name of ${name}`;
      else if (fields.length === 1 && fields[0] === 'type') text = `Type of ${name}`;
      out.push({ text, where: placeOf(e) });
    }
    for (const [entry, e] of was) if (!now.has(entry)) out.push({ text: `Deleted ${named(e) || `${word} ${entry}`}`, where: null });
  }
  return out;
}

function describeEntities(part: EntitiesPart): Described {
  const changes = entityChanges(part.before, part.after);
  if (changes.length === 1) return { label: changes[0]!.text, where: changes[0]!.where };
  return { label: `NPCs and objects: ${changes.length} changes`, where: changes.find((c) => c.where)?.where ?? null };
}

/** A step's name and where it happened, from what it changed; a name the window gave is kept */
export function describeStep(step: HistoryStep): Omit<StepSummary, 'id'> {
  const quests = step.parts.filter((p): p is QuestPart => p.kind === 'quest');
  const world = step.parts.find((p): p is WorldPart => p.kind === 'world');
  const entities = step.parts.find((p): p is EntitiesPart => p.kind === 'entities');
  const positions = step.parts.find((p) => p.kind === 'positions');
  const kind: StepSummary['kind'] = quests.length > 0 ? 'quest' : world ? 'world' : entities ? 'entities' : positions ? 'graph' : 'project';

  let derived: Described;
  if (quests.length > 0) derived = describeQuests(quests);
  else if (world) derived = describeWorld(world);
  else if (entities) derived = describeEntities(entities);
  else if (positions && positions.kind === 'positions') {
    const n = positions.after.length;
    derived = { label: n === 1 ? 'Moved a quest on the graph' : `Moved ${n} quests on the graph`, where: null };
  } else derived = { label: 'Renamed the project', where: null };

  if (step.label) return { label: step.label, kind, where: step.where ?? derived.where };
  return { label: derived.label, kind, where: step.where ?? derived.where };
}
