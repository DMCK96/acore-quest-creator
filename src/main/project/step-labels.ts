import { isDeepStrictEqual } from 'node:util';
import { fieldById } from '../../core/registry';
import { moduleById, ownerOf } from '../../core/modules/catalog';
import type { ModuleId } from '../../core/modules/model';
import { movementsOf, type WorldLayer, type WorldRouteEdit } from '../../core/world/layer';
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
    out.push({ text: was ? `Moved ${s.name}` : `Placed ${s.name}`, where: { map: s.map, x: at.x, y: at.y, z: at.z, spawn: { kind: s.kind, guid: s.guid } } });
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
  return out;
}

function describeWorld(part: WorldPart): Described {
  const changes = worldChanges(part.before, part.after);
  if (changes.length === 1) return { label: changes[0]!.text, where: changes[0]!.where };
  return { label: `World: ${changes.length} changes`, where: changes.find((c) => c.where)?.where ?? null };
}

/** A step's name and where it happened, from what it changed; a name the window gave is kept */
export function describeStep(step: HistoryStep): Omit<StepSummary, 'id'> {
  const quests = step.parts.filter((p): p is QuestPart => p.kind === 'quest');
  const world = step.parts.find((p): p is WorldPart => p.kind === 'world');
  const positions = step.parts.find((p) => p.kind === 'positions');
  const kind: StepSummary['kind'] = quests.length > 0 ? 'quest' : world ? 'world' : positions ? 'graph' : 'project';

  let derived: Described;
  if (quests.length > 0) derived = describeQuests(quests);
  else if (world) derived = describeWorld(world);
  else if (positions && positions.kind === 'positions') {
    const n = positions.after.length;
    derived = { label: n === 1 ? 'Moved a quest on the graph' : `Moved ${n} quests on the graph`, where: null };
  } else derived = { label: 'Renamed the project', where: null };

  if (step.label) return { label: step.label, kind, where: step.where ?? derived.where };
  return { label: derived.label, kind, where: step.where ?? derived.where };
}
