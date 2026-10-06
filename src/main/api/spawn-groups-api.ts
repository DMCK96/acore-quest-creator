import { isDeepStrictEqual } from 'node:util';
import type { Issue } from '../../core/validate/validate';
import { deleteGroup, dropGroupMember, dropMember, dropQuestMember, groupsOf, putGroup, revertGroup, type WorldLayer } from '../../core/world/layer';
import { isQuestPool, memberKey } from '../../core/world/groups';
import { databaseQuestFacts, projectQuestFacts, spawnsUnder } from '../world/groups-api';
import type { GroupView, SpawnGroupsApi } from '../../shared/ipc';
import type { Services } from './services';
import { fail, run } from './errors';

/** Spawn groups and quest rotations: reading, checking, saving and deleting them */
export function createSpawnGroupsApi(s: Services): SpawnGroupsApi {
  const { deps, connected, quests, asOneStep, projectEntities } = s.ctx;
  const { pools, groupOf, checkGroup, motherToRead, renumberGroup, freeGroupId, spawnAt, groupSpots } = s.groups;

  return {
    worldGroup: (id) => run(async () => groupOf(connected().db, id)),

    worldGroupSpawns: (id) =>
      run(async () => {
        const db = connected().db;
        return spawnsUnder(db, deps.session.world.get(), await pools(db), id);
      }),

    worldGroupView: (id) =>
      run(async () => {
        const db = connected().db;
        const group = await groupOf(db, id);
        if (!group) return null;
        const store = projectEntities();
        const members: GroupView['members'] = [];
        for (const m of group.members) {
          // Quest members are not shown in the 3D view's group card
          if (m.type === 'quest') continue;
          if (m.type === 'group') {
            const child = await groupOf(db, m.id);
            // A group member stands at the centre of every spawn under it
            const spots = await groupSpots(db, m.id, new Set([group.id]));
            const mean = (axis: 'x' | 'y' | 'z') => spots.reduce((sum, s) => sum + s[axis], 0) / spots.length;
            members.push({
              key: memberKey(m), type: 'group', name: child?.name ?? `Group ${m.id}`, chance: m.chance,
              at: spots.length > 0 ? { x: mean('x'), y: mean('y'), z: mean('z') } : null,
            });
            continue;
          }
          const table = m.kind === 'npc' ? 'creature' : 'gameobject';
          const own = (m.kind === 'npc' ? store.npcs : store.objects).find((e) => e.entry === m.entry);
          const placedName = deps.session.world.get().added.find((a) => a.kind === table && a.guid === m.guid)?.name;
          const name = own?.name ?? placedName ?? (await db.lookupNames(table, [m.entry])).get(m.entry) ?? '';
          members.push({ key: memberKey(m), type: 'spawn', name, chance: m.chance, at: await spawnAt(db, m.kind, m.guid) });
        }
        let event: GroupView['event'] = null;
        if (group.event) {
          const named = (await db.columns('game_event')).length > 0 ? await db.selectRows('game_event', { eventEntry: String(group.event.id) }) : [];
          event = { id: group.event.id, name: named[0]?.description || `Event ${group.event.id}`, during: group.event.during };
        }
        return { id: group.id, name: group.name, map: group.map, maxActive: group.maxActive, event, members };
      }),

    worldGroupsOnMap: (map) =>
      run(async () => {
        const db = connected().db;
        const layer = groupsOf(deps.session.world.get());
        const byId = new Map<number, { id: number; name: string; maxActive: number; members: number; groups: number[] }>();
        for (const pool of await pools(db)) {
          if (pool.map === map) byId.set(pool.id, { id: pool.id, name: pool.name, maxActive: pool.maxActive, members: pool.members, groups: pool.groups });
        }
        // The layer's copy wins; one removed there, or moved to another map, is left out, as is a rotation (it has no map)
        for (const g of layer) {
          byId.delete(g.id);
          if (!g.removed && !isQuestPool(g) && g.map === map) byId.set(g.id, { id: g.id, name: g.name, maxActive: g.maxActive, members: g.members.length, groups: g.members.flatMap((m) => (m.type === 'group' ? [m.id] : [])) });
        }
        // Only member groups the map lists are named, so a listed group never points at one that is not there
        for (const g of byId.values()) g.groups = g.groups.filter((id) => byId.has(id));
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
      }),

    worldNewGroupId: () => run(async () => freeGroupId(connected().db)),

    questPools: () =>
      run(async () => {
        const db = connected().db;
        const byId = new Map<number, { id: number; name: string; maxActive: number; daily: boolean; questIds: number[] }>();
        for (const pool of await pools(db)) {
          if (pool.quests.length > 0) byId.set(pool.id, { id: pool.id, name: pool.name, maxActive: pool.maxActive, daily: pool.daily, questIds: [...pool.quests] });
        }
        // The layer's copy wins; one removed there, or no longer a rotation, is left out
        const layerPools = groupsOf(deps.session.world.get());
        for (const g of layerPools) byId.delete(g.id);
        const rotations = layerPools.filter((g) => !g.removed && isQuestPool(g));
        if (rotations.length > 0) {
          const own = quests.list();
          const questIds = rotations.flatMap((g) => g.members.flatMap((m) => (m.type === 'quest' ? [m.questId] : [])));
          const fromDb = await databaseQuestFacts(db, questIds.filter((id) => !own.some((q) => q.questId === id)));
          const facts = (id: number) => {
            const mine = own.find((q) => q.questId === id);
            return mine ? projectQuestFacts(mine) : (fromDb.get(id) ?? null);
          };
          for (const g of rotations) {
            const ids = g.members.flatMap((m) => (m.type === 'quest' ? [m.questId] : []));
            const kinds = ids.map(facts);
            // Daily unless its quests are weekly, as the database's are read
            const daily = kinds.some((k) => k?.daily) || !kinds.some((k) => k?.weekly);
            byId.set(g.id, { id: g.id, name: g.name, maxActive: g.maxActive, daily, questIds: ids });
          }
        }
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
      }),

    worldCheckGroup: (sent, moves) =>
      run(async () => {
        const { reasons, notes } = await checkGroup(connected().db, sent, moves);
        return { reasons, notes };
      }),

    worldSetGroup: (sent, moves) =>
      run(() => asOneStep(async () => {
        const db = connected().db;
        const { group, reasons, left } = await checkGroup(db, sent, moves);
        if (reasons.length > 0) {
          throw fail('VALIDATION', 'This spawn group cannot be saved.', { issues: reasons.map((message): Issue => ({ severity: 'error', code: 'GROUP', message })) });
        }
        // Nothing is awaited from here to the layer being put back, so an edit made meanwhile is kept.
        // The database group each moved spawn leaves is read into the layer first, so it is kept there without it.
        const absent = (layer: WorldLayer, id: number) => !groupsOf(layer).some((g) => g.id === id);
        let next = deps.session.world.get();
        for (const { read, mother } of left) {
          if (read && absent(next, read.id)) next = putGroup(next, read);
          if (mother && absent(next, mother.id)) next = putGroup(next, mother);
        }
        for (const move of moves) next = move.kind === 'quest' ? dropQuestMember(next, move.questId) : dropMember(next, move.kind, move.guid);
        for (const { after } of left) {
          const now = groupsOf(next).find((g) => g.id === after.id);
          if (!now || now.members.length === 0 || (isQuestPool(now) && now.members.length < 2)) {
            // Emptied, or a rotation left with one quest: deleted, as Delete group would, and let go of by the group holding it
            next = dropGroupMember(next, after.id);
            if (now) next = deleteGroup(next, now);
          } else {
            next = putGroup(next, { ...now, maxActive: Math.max(1, Math.min(now.maxActive, now.members.length)) });
          }
        }
        // A new group given a new id leaves its old one, and a group holding it follows it there
        if (group.id !== sent.id) next = renumberGroup(revertGroup(next, sent.id), sent.id, group.id);
        next = putGroup(next, group);
        deps.session.world.put(next);
        return next;
      })),

    worldDeleteGroup: (id) =>
      run(async () => {
        const db = connected().db;
        const group = await groupOf(db, id);
        if (!group) throw fail('BAD_REQUEST', `There is no spawn group ${id}.`);
        // A database group that holds it, and that the layer has not changed, is read in so it can let go of it
        const mother = await motherToRead(db, deps.session.world.get(), id);
        // Nothing is awaited from here to the layer being put back, so it is one step
        let next = deps.session.world.get();
        if (mother && !groupsOf(next).some((g) => g.id === mother.id)) next = putGroup(next, mother);
        next = deleteGroup(dropGroupMember(next, id), group);
        deps.session.world.put(next);
        return next;
      }),

    worldDropMember: (kind, guid) =>
      run(async () => {
        const layer = deps.session.world.get();
        const next = dropMember(layer, kind, guid);
        if (!isDeepStrictEqual(groupsOf(next), groupsOf(layer))) deps.session.world.put(next);
        return next;
      }),
  };
}
