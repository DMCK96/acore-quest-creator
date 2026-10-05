import { groupsOf, movementsOf, respawnsOf, type WorldLayer } from '../world/layer';
import { spawnKindOf, type EntityChange, type EntityKind, type SpawnLocation, type TrackedEntity } from './entity';
import type { QuestUse } from './links';
import type { ProjectEntities, StoredOrigin } from './model';

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
 * Every new NPC, object and item, every existing one edited in the project (its details), and every
 * existing NPC or object the project changed through the world layer (spawn moves, placed spawns,
 * movement, paths, respawn times, spawn groups), with what changed and the quests using it.
 */
export function trackedEntities(input: { store: ProjectEntities; layer: WorldLayer; quests: readonly TrackedQuest[] }): TrackedEntity[] {
  const { store, layer, quests } = input;
  const rows = new Map<string, TrackedEntity>();
  const keyOf = (kind: EntityKind, entry: number): string => `${kind}:${entry}`;

  const touched = new Map<string, { kind: EntityKind; entry: number; name: string; changes: Set<EntityChange>; goTo: SpawnLocation | null }>();
  const touch = (kind: EntityKind, entry: number, name: string, change: EntityChange, goTo?: SpawnLocation): void => {
    const key = keyOf(kind, entry);
    if (rows.get(key)?.origin === 'new') return;
    let t = touched.get(key);
    if (!t) touched.set(key, (t = { kind, entry, name: '', changes: new Set(), goTo: null }));
    if (!t.name && name) t.name = name;
    t.changes.add(change);
    if (change === 'spawns' && !t.goTo && goTo) t.goTo = goTo;
  };

  // A new one is listed as new; an existing one edited here has its details changed, merged with any layer changes
  const add = (kind: EntityKind, entry: number, origin: StoredOrigin, name: string, fallback: string, goTo: SpawnLocation | null): void => {
    if (origin.kind === 'existing') touch(kind, entry, name.trim(), 'details');
    else rows.set(keyOf(kind, entry), { kind, entry, name: name.trim() || fallback, origin: 'new', changes: ['new'], usedBy: [], goTo });
  };
  for (const n of store.npcs) {
    const s = n.spawns[0];
    add('npc', n.entry, n.origin, n.name, `New NPC ${n.entry}`, s ? { kind: 'creature', guid: s.guid, map: s.map, x: s.x, y: s.y, z: s.z } : null);
  }
  for (const o of store.objects) {
    const s = o.spawns[0];
    add('object', o.entry, o.origin, o.name, `New object ${o.entry}`, s ? { kind: 'object', guid: s.guid, map: s.map, x: s.x, y: s.y, z: s.z } : null);
  }
  for (const i of store.items) add('item', i.entry, i.origin, i.name, `New item ${i.entry}`, null);
  const locate = (kind: 'creature' | 'gameobject', guid: number, map: number, p: { x: number; y: number; z: number }): SpawnLocation => ({
    kind: kind === 'creature' ? 'creature' : 'object', guid, map, x: p.x, y: p.y, z: p.z,
  });

  for (const s of layer.spawns) touch(spawnKindOf(s.kind), s.entry, s.name, 'spawns', locate(s.kind, s.guid, s.map, s.current));
  for (const a of layer.added) touch(spawnKindOf(a.kind), a.entry, a.name, 'spawns', locate(a.kind, a.guid, a.map, a.placement));
  for (const r of respawnsOf(layer)) touch(spawnKindOf(r.kind), r.entry, r.name, 'spawns');
  const movements = movementsOf(layer);
  for (const m of movements) touch('npc', m.entry, m.name, 'movement');
  for (const r of layer.routes) {
    const walkers = r.original.length === 0
      ? movements.filter((m) => m.current.pathId === r.pathId).map((m) => ({ entry: m.entry, name: m.name }))
      : (r.walkerEntries ?? []);
    for (const w of walkers) touch('npc', w.entry, w.name, 'path');
  }
  // Every entity with a spawn in a group the project made or changed; members only carry an entry, not a name
  for (const g of groupsOf(layer)) {
    for (const m of g.members) if (m.type === 'spawn') touch(m.kind, m.entry, '', 'group');
  }
  for (const t of touched.values()) {
    const changes = CHANGE_ORDER.filter((c) => t.changes.has(c));
    const name = t.name || `${t.kind === 'npc' ? 'NPC' : t.kind === 'object' ? 'Object' : 'Item'} ${t.entry}`;
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
