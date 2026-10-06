import type { WorldDb } from '../../core/db/world-db';
import { rowsOrNone } from '../../core/links/context';
import { groupsOf, type WorldLayer } from '../../core/world/layer';
import { isQuestPool, validateGroup, type GroupMember, type SpawnGroup } from '../../core/world/groups';
import { groupContext, listPools, readGroup } from '../world/groups-api';
import { readPlacement } from '../world/world-api';
import type { ApiContext } from './context';

export type GroupMoveArg = { kind: 'npc' | 'object'; guid: number } | { kind: 'quest'; questId: number };
export type LeftGroup = { after: SpawnGroup; read: SpawnGroup | null; mother: SpawnGroup | null };

/** Spawn groups (pools) as the layer and the database have them, and the checks a save goes through */
export function createSpawnGroups(ctx: ApiContext) {
  const { deps, quests, projectEntities } = ctx;

  /**
   * Every pool with its map (and a quest pool with its quests), read once per connection (a new
   * connection has its own database object) rather than on each Find, group dialog open or graph
   * load: on a large database that is tens of thousands of rows. Read again after an export, since
   * the patch is about to change the pools.
   */
  let poolCache: { db: WorldDb; pools: ReturnType<typeof listPools> } | null = null;
  const pools = (db: WorldDb): ReturnType<typeof listPools> => {
    if (poolCache?.db !== db) {
      const read = listPools(db);
      poolCache = { db, pools: read };
      // A failed read is not kept
      read.catch(() => {
        if (poolCache?.pools === read) poolCache = null;
      });
    }
    return poolCache.pools;
  };
  /** Forgets the pools read, so the next read sees what an export is about to change */
  const forgetPools = (): void => {
    poolCache = null;
  };

  /** Whether a member is one `moves` takes out of the group it is in */
  const isMoved = (m: GroupMember, moves: readonly GroupMoveArg[]): boolean =>
    moves.some((mv) => (mv.kind === 'quest' ? m.type === 'quest' && m.questId === mv.questId : m.type === 'spawn' && m.kind === mv.kind && m.guid === mv.guid));

  /** A spawn group as the layer has it, else as the database's pool; null when there is neither */
  async function groupOf(db: WorldDb, id: number): Promise<SpawnGroup | null> {
    const known = groupsOf(deps.session.world.get()).find((g) => g.id === id);
    return known ?? (await readGroup(db, id));
  }

  /**
   * A group sent by the renderer as main saves or checks it: its origin is the layer copy's, else the
   * database pool's (with the rows it was read from), else new; the origin and `removed` it was sent with
   * are not trusted. A new group (the layer's, or one sent as new) whose id the database has taken for a
   * pool since gets the next free id.
   */
  async function trustedGroup(db: WorldDb, sent: SpawnGroup): Promise<SpawnGroup> {
    const { removed: _removed, origin: claimed, ...fields } = sent;
    const copy = groupsOf(deps.session.world.get()).find((g) => g.id === sent.id);
    if (copy && copy.origin.kind === 'existing') return { ...fields, origin: copy.origin };
    const pool = await readGroup(db, sent.id);
    if (copy || claimed.kind === 'new') return { ...fields, id: pool ? await freeGroupId(db) : sent.id, origin: { kind: 'new' } };
    return { ...fields, origin: pool ? pool.origin : { kind: 'new' } };
  }

  /**
   * A sent group as main would save it; why the server would refuse it or a group its moves leave (each
   * reason of a left group named by it); notes on left groups the moves empty, which the save deletes;
   * and the left groups themselves
   */
  async function checkGroup(
    db: WorldDb,
    sent: SpawnGroup,
    moves: readonly GroupMoveArg[],
  ): Promise<{ group: SpawnGroup; reasons: string[]; notes: string[]; left: LeftGroup[] }> {
    const layer = deps.session.world.get();
    const store = projectEntities();
    const group = await trustedGroup(db, sent);
    // A layer group given a new id is checked by the id the layer knows it by
    const asKnown = groupsOf(layer).some((g) => g.id === sent.id) ? { ...group, id: sent.id } : group;
    const reasons = validateGroup(asKnown, await groupContext(db, layer, store, moves, asKnown, quests.list()));
    const notes: string[] = [];
    const left = await leftGroups(db, layer, new Set([sent.id, group.id]), moves);
    for (const { after } of left) {
      const name = after.name || `Group ${after.id}`;
      if (after.members.length === 0) notes.push(`${name} would then be empty and is deleted.`);
      else if (isQuestPool(after) && after.members.length < 2) notes.push(`${name} would then have one quest and is deleted.`);
      else reasons.push(...validateGroup(after, await groupContext(db, layer, store, moves, after, quests.list())).map((reason) => `${name} would then: ${reason}`));
    }
    return { group, reasons, notes, left };
  }

  /**
   * The groups `moves` take spawns or quests out of, but those in `skip`: each as it would be after (without them, and
   * no more of it up than it has members), with the database copy to read into the layer when the layer has
   * none, and for one left empty the database group holding it that must let go of it
   */
  async function leftGroups(db: WorldDb, layer: WorldLayer, skip: ReadonlySet<number>, moves: readonly GroupMoveArg[]): Promise<LeftGroup[]> {
    const found = new Map<number, { group: SpawnGroup; read: SpawnGroup | null }>();
    for (const move of moves) {
      const held = groupsOf(layer).find((g) => !g.removed && g.members.some((m) => isMoved(m, [move])));
      if (held) {
        if (!skip.has(held.id)) found.set(held.id, { group: held, read: null });
        continue;
      }
      const [row] =
        move.kind === 'quest'
          ? await rowsOrNone(db, 'pool_quest', { entry: [String(move.questId)] })
          : await rowsOrNone(db, move.kind === 'npc' ? 'pool_creature' : 'pool_gameobject', { guid: [String(move.guid)] });
      const pool = row ? Number(row.pool_entry) : null;
      // A database group the layer has changed is known by the layer's copy, which does not hold it
      if (pool === null || skip.has(pool) || found.has(pool) || groupsOf(layer).some((g) => g.id === pool)) continue;
      const read = await readGroup(db, pool);
      if (read) found.set(pool, { group: read, read });
    }
    const out: LeftGroup[] = [];
    for (const { group, read } of found.values()) {
      const members = group.members.filter((m) => !isMoved(m, moves));
      const after = { ...group, members, maxActive: members.length === 0 ? group.maxActive : Math.max(1, Math.min(group.maxActive, members.length)) };
      out.push({ after, read, mother: members.length === 0 ? await motherToRead(db, layer, group.id) : null });
    }
    return out;
  }

  /** The database group holding group `id`, when the layer has no copy of it and no layer group holds `id` */
  async function motherToRead(db: WorldDb, layer: WorldLayer, id: number): Promise<SpawnGroup | null> {
    const heldInLayer = groupsOf(layer).some((g) => !g.removed && g.members.some((m) => m.type === 'group' && m.id === id));
    const [row] = heldInLayer ? [] : await rowsOrNone(db, 'pool_pool', { pool_id: String(id) });
    const motherId = row ? Number(row.mother_pool) : null;
    return motherId !== null && !groupsOf(layer).some((g) => g.id === motherId) ? await readGroup(db, motherId) : null;
  }

  /** Points every layer group that holds group `from` at group `to` instead */
  function renumberGroup(layer: WorldLayer, from: number, to: number): WorldLayer {
    const groups = groupsOf(layer).map((g) =>
      g.members.some((m) => m.type === 'group' && m.id === from)
        ? { ...g, members: g.members.map((m) => (m.type === 'group' && m.id === from ? { ...m, id: to } : m)) }
        : g,
    );
    return { ...layer, groups };
  }

  /** An id no spawn group uses yet: past the database's pools and the layer's groups */
  async function freeGroupId(db: WorldDb): Promise<number> {
    let dbMax = 0;
    try {
      dbMax = (await db.selectMax?.('pool_template', 'entry')) ?? 0;
    } catch {
      dbMax = 0;
    }
    return Math.max(dbMax, ...groupsOf(deps.session.world.get()).map((g) => g.id), 0) + 1;
  }

  /** Where a spawn stands: as moved or placed in the layer, as the project has it, else as the database has it */
  async function spawnAt(db: WorldDb, kind: 'npc' | 'object', guid: number): Promise<{ x: number; y: number; z: number } | null> {
    const table = kind === 'npc' ? 'creature' : 'gameobject';
    const layer = deps.session.world.get();
    const at =
      layer.spawns.find((s) => s.kind === table && s.guid === guid)?.current ??
      layer.added.find((a) => a.kind === table && a.guid === guid)?.placement ??
      (kind === 'npc' ? projectEntities().npcs : projectEntities().objects).flatMap((e) => e.spawns).find((s) => s.guid === guid) ??
      (await readPlacement(db, table, guid))?.placement;
    return at ? { x: at.x, y: at.y, z: at.z } : null;
  }

  /** Every spawn under a group, through its member groups, where it stands */
  async function groupSpots(db: WorldDb, id: number, seen: Set<number>): Promise<{ x: number; y: number; z: number }[]> {
    if (seen.has(id)) return [];
    seen.add(id);
    const group = await groupOf(db, id);
    const spots: { x: number; y: number; z: number }[] = [];
    for (const m of group?.members ?? []) {
      if (m.type === 'group') spots.push(...(await groupSpots(db, m.id, seen)));
      else if (m.type === 'spawn') {
        const at = await spawnAt(db, m.kind, m.guid);
        if (at) spots.push(at);
      }
    }
    return spots;
  }
  return { pools, forgetPools, groupOf, trustedGroup, checkGroup, leftGroups, motherToRead, renumberGroup, freeGroupId, spawnAt, groupSpots, isMoved };
}

export type SpawnGroups = ReturnType<typeof createSpawnGroups>;
