import { SPAWN_VIEW_CAP } from '@core/db/view-spawns';
import { rowsOrNone } from '../../core/links/context';
import type { QuestAggregate } from '../../core/model/aggregate';
import { movementsOf } from '../../core/world/layer';
import type { MapApi, QuestSpawn, QuestSpawnGroup, SpawnDot } from '../../shared/ipc';
import { buildClientMaps } from '@core/map/client-maps';
import type { WorldMap } from '@core/map/world-maps';
import { MAP_FILE } from '@core/game/maps-dbc';
import { parseTaxiPathNodes, TAXI_PATH_NODE_FILE, type TaxiNode } from '@core/game/taxi-path';
import { buildTransportMaps, type TransportRow } from '@core/map/transports';
import { WORLD_MAPS } from '@core/map/world-maps';
import { floorsAt } from '../../core/game/navmesh';
import { objectivesOf, relationOwners } from '../../core/entities/links';
import { gridFileName, terrainHeight } from '../../core/game/terrain';
import type { Services } from './services';
import { run } from './errors';

const REF_SPAWNS_PER_ENTRY = 20;
/** Spawns of one NPC or object listed for jumping to in the 3D view; more is said, not given. */
const FIND_SPAWNS_LIMIT = 300;
/** Spawns listed per NPC or object a quest names, when its spawns are shown in the 3D view */
const QUEST_SPAWNS_PER_ENTRY = 200;

/** The 3D view: ground, floors, maps, spawns near a place or of a quest, and new path ids */
export function createMapApi(s: Services): MapApi {
  const { deps, conn, connected, questOf, projectEntities, questEntities } = s.ctx;
  const { terrainAt, navTileAt } = s.files;
  const { spawnAt } = s.groups;

  /**
   * A path id no route uses yet, for a new path of the spawn `guid`: the database's own convention of
   * the guid times ten when that is free, else one past the highest id in use. In use counts the
   * database, the project's patrols and the world layer's routes and new paths.
   */
  async function freePathId(guid: number): Promise<number> {
    const live = connected();
    const layer = deps.session.world.get();
    const used = [
      ...projectEntities().npcs.flatMap((n) => n.spawns.flatMap((s) => (s.patrol ? [s.patrol.pathId] : []))),
      ...layer.routes.map((r) => r.pathId),
      ...movementsOf(layer).flatMap((m) => (m.current.pathId === null ? [] : [m.current.pathId])),
    ];
    const candidate = guid * 10;
    const inDb = (await rowsOrNone(live.db, 'waypoint_data', { id: [String(candidate)] })).length > 0;
    if (!inDb && !used.includes(candidate)) return candidate;
    let dbMax = 0;
    try {
      dbMax = (await live.db.selectMax?.('waypoint_data', 'id')) ?? 0;
    } catch {
      dbMax = 0;
    }
    return Math.max(dbMax, ...used, 0) + 1;
  }

  /** The existing NPCs and objects a quest names, by role: givers, enders, then objectives */
  function wantedOf(aggregate: QuestAggregate): { role: QuestSpawn['role']; kind: 'creature' | 'gameobject'; entry: number }[] {
    const wanted: { role: QuestSpawn['role']; kind: 'creature' | 'gameobject'; entry: number }[] = [];
    for (const [role, relation] of [['giver', 'starter'], ['ender', 'ender']] as const) {
      for (const owner of relationOwners(aggregate, relation)) {
        if (owner.kind === 'creature' || owner.kind === 'gameobject') wanted.push({ role, kind: owner.kind, entry: owner.entry });
      }
    }
    for (const entry of objectivesOf(aggregate)) {
      if (entry > 0) wanted.push({ role: 'objective', kind: 'creature', entry });
      else if (entry < 0) wanted.push({ role: 'objective', kind: 'gameobject', entry: -entry });
    }
    return wanted;
  }
  /** The client's other maps, read once per client folder */
  let clientMaps: { dir: string; maps: Promise<WorldMap[]> } | null = null;
  async function clientMapList(): Promise<WorldMap[]> {
    const dir = (await deps.clientStatus?.())?.dir;
    const read = deps.clientFile;
    if (!dir || !read) return [];
    if (clientMaps?.dir !== dir) {
      clientMaps = {
        dir,
        maps: (async () => {
          const dbc = await read(`DBFilesClient/${MAP_FILE}`);
          return dbc ? buildClientMaps(dbc, read) : [];
        })(),
      };
    }
    return clientMaps.maps;
  }
  /** The transports' routes and map names, read once per client folder; a missing or unreadable route file means none */
  interface TaxiFiles { paths: Map<number, TaxiNode[]>; mapDbc: Uint8Array | null }
  let taxiPaths: { dir: string; files: Promise<TaxiFiles> } | null = null;
  async function taxiFiles(dir: string): Promise<TaxiFiles> {
    const read = deps.clientFile;
    if (!read) return { paths: new Map(), mapDbc: null };
    if (taxiPaths?.dir !== dir) {
      taxiPaths = {
        dir,
        files: (async () => {
          const mapDbc = await read(`DBFilesClient/${MAP_FILE}`);
          try {
            const dbc = await read(`DBFilesClient/${TAXI_PATH_NODE_FILE}`);
            return { paths: dbc ? parseTaxiPathNodes(dbc) : new Map<number, TaxiNode[]>(), mapDbc };
          } catch {
            return { paths: new Map<number, TaxiNode[]>(), mapDbc };
          }
        })(),
      };
    }
    return taxiPaths.files;
  }
  /** The transport maps: their spawns are vessel-local, so they never go through startedAtSpawn */
  async function transportMapList(terrain: WorldMap[]): Promise<WorldMap[]> {
    const dir = (await deps.clientStatus?.())?.dir;
    const db = conn.current()?.db;
    if (!dir || !db) return [];
    const { paths, mapDbc } = await taxiFiles(dir);
    if (paths.size === 0) return [];
    const rows: TransportRow[] = (await rowsOrNone(db, 'gameobject_template', { type: ['15'] })).map((r) => ({
      entry: Number(r.entry), name: String(r.name ?? ''), displayId: Number(r.displayId), pathId: Number(r.Data0), map: Number(r.Data6),
    }));
    if (rows.length === 0) return [];
    const hosts = new Map<number, WorldMap>([...WORLD_MAPS, ...terrain].map((m) => [m.id, m]));
    return buildTransportMaps({ rows, paths, mapDbc, hostOf: (id) => hosts.get(id) ?? null });
  }
  /** Starts a map at a spawn of the database's when it has one there: the middle of a tile may be nowhere */
  async function startedAtSpawn(map: WorldMap): Promise<WorldMap> {
    const db = conn.current()?.db;
    if (!db?.spawnsForView) return map;
    const everywhere = { minX: -17100, maxX: 17100, minY: -17100, maxY: 17100 };
    try {
      const { creatures, objects } = await db.spawnsForView(map.id, everywhere, 1);
      const spawn = creatures[0] ?? objects[0];
      return spawn ? { ...map, start: { x: spawn.x, y: spawn.y, z: spawn.z } } : map;
    } catch {
      return map;
    }
  }
  return {
    clientMaps: () =>
      run(async () => {
        const terrain = await clientMapList();
        const started = await Promise.all(terrain.map(startedAtSpawn));
        return [...started, ...(await transportMapList(terrain))];
      }),
    patrolPathId: (guid) =>
      run(async () => {
        const pinned = projectEntities().npcs.flatMap((n) => n.spawns).find((s) => s.guid === guid)?.patrol;
        if (pinned) return pinned.pathId;
        return freePathId(guid);
      }),

    worldNewPathId: (guid) => run(async () => freePathId(guid)),

    groundHeight: (map, x, y) =>
      run(async () => {
        const live = connected();
        const dir = live.serverData?.status.dir;
        if (!dir) return { reason: 'Set the server data folder on the connection to read ground heights.' };
        const name = gridFileName(map, x, y);
        const loaded = await terrainAt(dir, map, x, y);
        if ('reason' in loaded) return loaded;
        const file = loaded.file;
        if (!file) return { reason: `No map file covers this point (${name}).` };
        const z = terrainHeight(file, x, y);
        if (z === null) return { reason: 'There is no ground here (a hole in the terrain).' };
        return { z: Math.round(z * 100) / 100 };
      }),

    mapFloors: (map, x, y) =>
      run(async () => {
        const live = connected();
        const dir = live.serverData?.status.dir;
        if (!dir) return { reason: 'Set the server data folder on the connection to read floors.' };
        const tile = await navTileAt(live, dir, map, x, y);
        const terrain = await terrainAt(dir, map, x, y);
        const height = 'file' in terrain && terrain.file ? terrainHeight(terrain.file, x, y) : null;
        const ground = height === null || !Number.isFinite(height) ? null : Math.round(height * 100) / 100;
        return { floors: tile ? floorsAt(tile, x, y) : [], ground };
      }),

    viewSpawns: (map, area) =>
      run(async () => {
        const db = connected().db;
        if (!db.spawnsForView) return { creatures: [], objects: [], capped: { creatures: false, objects: false } };
        const { creatures, objects } = await db.spawnsForView(map, area, SPAWN_VIEW_CAP + 1);
        return {
          creatures: creatures.slice(0, SPAWN_VIEW_CAP),
          objects: objects.slice(0, SPAWN_VIEW_CAP),
          capped: { creatures: creatures.length > SPAWN_VIEW_CAP, objects: objects.length > SPAWN_VIEW_CAP },
        };
      }),

    entitySpawns: (kind, entry) =>
      run(async () => (await connected().db.spawnsOfEntries?.(kind, [entry], REF_SPAWNS_PER_ENTRY)) ?? []),

    findSpawns: (kind, entry) =>
      run(async () => {
        const found = (await connected().db.spawnsOfEntries?.(kind, [entry], FIND_SPAWNS_LIMIT + 1)) ?? [];
        return { spawns: found.slice(0, FIND_SPAWNS_LIMIT), capped: found.length > FIND_SPAWNS_LIMIT };
      }),

    spawnPlacement: (kind, guid) => run(async () => spawnAt(connected().db, kind, guid)),

    questSpawnList: (questIds) =>
      run(async () => {
        // Without the world database, only the project's own spawns and the layer's are listed
        const db = conn.current()?.db;
        const groups: QuestSpawnGroup[] = [];
        for (const questId of questIds) {
          const aggregate = questOf(questId).aggregate;
          const title = aggregate.values['quest_template.LogTitle'];
          const { npcs, objects } = questEntities(aggregate);
          const spawns: QuestSpawn[] = [];
          const seen = new Set<string>();
          const add = (spawn: QuestSpawn): void => {
            const key = `${spawn.kind}:${spawn.guid}`;
            if (seen.has(key)) return;
            seen.add(key);
            spawns.push(spawn);
          };
          const wanted = wantedOf(aggregate);
          // A project NPC or object takes the first part the quest names it in (giver, ender, objective), else 'own'
          const partOf = (kind: 'creature' | 'gameobject', entry: number): QuestSpawn['role'] =>
            wanted.find((w) => w.kind === kind && w.entry === entry)?.role ?? 'own';
          // The quest's own NPCs and objects, where it puts them
          for (const [kind, owners] of [['creature', npcs], ['gameobject', objects]] as const) {
            for (const owner of owners) {
              const role = partOf(kind, owner.entry);
              for (const s of owner.spawns) add({ kind, guid: s.guid, entry: owner.entry, name: owner.name, map: s.map, x: s.x, y: s.y, z: s.z, role });
            }
          }
          const own = new Set([...npcs.map((n) => `creature:${n.entry}`), ...objects.map((o) => `gameobject:${o.entry}`)]);
          let cut = 0;
          // Existing NPCs and objects: where the World's layer moved them, and the spawns placed there
          const layer = deps.session.world.get();
          for (const want of wanted) {
            if (own.has(`${want.kind}:${want.entry}`)) continue;
            if (db?.spawnsOfEntries) {
              const dots: SpawnDot[] = await db.spawnsOfEntries(want.kind, [want.entry], QUEST_SPAWNS_PER_ENTRY + 1);
              if (dots.length > QUEST_SPAWNS_PER_ENTRY) cut += 1;
              for (const dot of dots.slice(0, QUEST_SPAWNS_PER_ENTRY)) {
                const at = layer.spawns.find((m) => m.kind === dot.kind && m.guid === dot.guid)?.current;
                add({ ...dot, ...(at ? { x: at.x, y: at.y, z: at.z } : {}), role: want.role });
              }
            } else {
              // Offline, the database spawns the layer moved are still known
              for (const m of layer.spawns) {
                if (m.kind !== want.kind || m.entry !== want.entry) continue;
                add({ kind: m.kind, guid: m.guid, entry: m.entry, name: m.name, map: m.map, x: m.current.x, y: m.current.y, z: m.current.z, role: want.role });
              }
            }
            for (const a of layer.added) {
              if (a.kind !== want.kind || a.entry !== want.entry) continue;
              add({ kind: a.kind, guid: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z, role: want.role });
            }
          }
          groups.push({ questId, title: typeof title === 'string' && title !== '' ? title : `Quest ${questId}`, spawns, capped: cut > 0, cut, ...(db ? {} : { offline: true }) });
        }
        return groups;
      }),
  };
}
