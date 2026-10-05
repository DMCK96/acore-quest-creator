import { movementsOf, type WorldLayer } from '../world/layer';
import { spawnKindOf, type EntityChange, type EntityKind, type SpawnLocation, type TrackedEntity } from './entity';
import type { QuestUse } from './links';
import type { ProjectEntities } from './model';

/** A quest as the graph lists it: what it uses from the store (credits included) and every entry it names */
export interface TrackedQuest {
  questId: number;
  uses: QuestUse;
  refs: QuestUse;
}

const CHANGE_ORDER: EntityChange[] = ['new', 'spawns', 'movement', 'path', 'details', 'group'];
const KIND_ORDER: Record<EntityKind, number> = { npc: 0, object: 1, item: 2 };
const LIST_OF = { npc: 'npcs', object: 'objects', item: 'items' } as const;

/**
 * Every new NPC, object and item, and every existing NPC or object the project changed through the
 * world layer (spawn moves, placed spawns, movement, paths), with what changed and the quests using it.
 */
export function trackedEntities(input: { store: ProjectEntities; layer: WorldLayer; quests: readonly TrackedQuest[] }): TrackedEntity[] {
  const { store, layer, quests } = input;
  const rows = new Map<string, TrackedEntity>();
  const keyOf = (kind: EntityKind, entry: number): string => `${kind}:${entry}`;

  const add = (kind: EntityKind, entry: number, name: string, goTo: SpawnLocation | null): void => {
    rows.set(keyOf(kind, entry), { kind, entry, name, origin: 'new', changes: ['new'], usedBy: [], goTo });
  };
  for (const n of store.npcs) {
    const s = n.spawns[0];
    add('npc', n.entry, n.name.trim() || `New NPC ${n.entry}`, s ? { kind: 'creature', guid: s.guid, map: s.map, x: s.x, y: s.y, z: s.z } : null);
  }
  for (const o of store.objects) {
    const s = o.spawns[0];
    add('object', o.entry, o.name.trim() || `New object ${o.entry}`, s ? { kind: 'object', guid: s.guid, map: s.map, x: s.x, y: s.y, z: s.z } : null);
  }
  for (const i of store.items) add('item', i.entry, i.name.trim() || `New item ${i.entry}`, null);

  const touched = new Map<string, { kind: EntityKind; entry: number; name: string; changes: Set<EntityChange>; goTo: SpawnLocation | null }>();
  const touch = (kind: 'npc' | 'object', entry: number, name: string, change: EntityChange, goTo?: SpawnLocation): void => {
    const key = keyOf(kind, entry);
    if (rows.get(key)?.origin === 'new') return;
    let t = touched.get(key);
    if (!t) touched.set(key, (t = { kind, entry, name: '', changes: new Set(), goTo: null }));
    if (!t.name && name) t.name = name;
    t.changes.add(change);
    if (change === 'spawns' && !t.goTo && goTo) t.goTo = goTo;
  };
  const locate = (kind: 'creature' | 'gameobject', guid: number, map: number, p: { x: number; y: number; z: number }): SpawnLocation => ({
    kind: kind === 'creature' ? 'creature' : 'object', guid, map, x: p.x, y: p.y, z: p.z,
  });

  for (const s of layer.spawns) touch(spawnKindOf(s.kind), s.entry, s.name, 'spawns', locate(s.kind, s.guid, s.map, s.current));
  for (const a of layer.added) touch(spawnKindOf(a.kind), a.entry, a.name, 'spawns', locate(a.kind, a.guid, a.map, a.placement));
  const movements = movementsOf(layer);
  for (const m of movements) touch('npc', m.entry, m.name, 'movement');
  for (const r of layer.routes) {
    const walkers = r.original.length === 0
      ? movements.filter((m) => m.current.pathId === r.pathId).map((m) => ({ entry: m.entry, name: m.name }))
      : (r.walkerEntries ?? []);
    for (const w of walkers) touch('npc', w.entry, w.name, 'path');
  }
  for (const t of touched.values()) {
    const changes = CHANGE_ORDER.filter((c) => t.changes.has(c));
    const name = t.name || `${t.kind === 'npc' ? 'NPC' : 'Object'} ${t.entry}`;
    rows.set(keyOf(t.kind, t.entry), { kind: t.kind, entry: t.entry, name, origin: 'existing', changes, usedBy: [], goTo: t.goTo });
  }

  const result = [...rows.values()].map((row): TrackedEntity => {
    const list = LIST_OF[row.kind];
    const usedBy = quests
      .filter((q) => q.uses[list].includes(row.entry) || q.refs[list].includes(row.entry))
      .map((q) => q.questId)
      .sort((a, b) => a - b);
    return { ...row, usedBy };
  });
  return result.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'en') || a.entry - b.entry);
}
