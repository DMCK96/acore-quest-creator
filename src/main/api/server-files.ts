import { join } from 'node:path';
import { rowsOrNone } from '../../core/links/context';
import { navTileFileName, parseNavTile, type NavTile } from '../../core/game/navmesh';
import { AREA_TABLE_FILE, MAP_FILE } from '../../core/game/maps-dbc';
import { TerrainFormatError, gridFileName, parseMapFile, type TerrainFile } from '../../core/game/terrain';
import { readServerDataFile, type ServerDataFiles } from '../server-data';
import { CAST_TIMES_FILE, RANGE_FILE, readSpellIndex, SPELL_FILE, type SpellIndex } from '../../core/game/spells';
import { buildExtendedCostIndex, EXTENDED_COST_FILE, readExtendedCosts, type ExtendedCostIndex } from '../../core/game/extended-costs';
import { readSoundIndex, SOUND_FILE, type SoundIndex } from '../../core/game/sounds';
import { QUEST_SORT_FILE, readQuestSorts, type QuestSortIndex } from '../../core/game/quest-sorts';
import { DISPLAY_FILES, readCreatureDisplays, readObjectDisplays, type DisplayIndex } from '../../core/game/displays';
import { FACTION_TEMPLATE_FILES, readFactionTemplates, type FactionTemplateIndex } from '../../core/game/faction-templates';
import type { EntityHit, LookKind } from '../../core/db/entity-search';
import type { ApiDeps } from './deps';
import type { Session } from './connection';

export const NO_SERVER_DATA_FILES: ServerDataFiles = { read: async () => null, isDir: async () => false };

const NAV_CACHE_SIZE = 64;
/** Picker results: enough to find a name, few enough to scan by eye. */
export const ENTITY_SEARCH_LIMIT = 25;
/** How many parsed terrain grids to keep: a quest's positions rarely span more than a few. */
const TERRAIN_CACHE_SIZE = 16;

/** The server data folder's files, each read once per connection (terrain grids once per folder) */
export function createServerFiles(deps: ApiDeps) {
  const terrainCache = new Map<string, TerrainFile | null>();

  /**
   * The terrain grid under a point, cached across sessions by folder and file: null when no map
   * file covers it, a reason when the file is damaged.
   */
  async function terrainAt(dir: string, map: number, x: number, y: number): Promise<{ file: TerrainFile | null } | { reason: string }> {
    const name = gridFileName(map, x, y);
    const key = `${dir}|${name}`;
    const cached = terrainCache.get(key);
    if (cached !== undefined) return { file: cached };
    const files = deps.mapDataFiles ?? deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
    let file: TerrainFile | null = null;
    // The folder may be the server's DataDir or its dbc folder; maps/ sits in the one, beside the other.
    for (const folder of [join(dir, 'maps'), join(dir, '..', 'maps')]) {
      const bytes = await files.read(folder, name);
      if (!bytes) continue;
      try {
        file = parseMapFile(bytes);
      } catch (error) {
        if (error instanceof TerrainFormatError) return { reason: `${name} could not be read: ${error.message}` };
        throw error;
      }
      break;
    }
    terrainCache.set(key, file);
    if (terrainCache.size > TERRAIN_CACHE_SIZE) terrainCache.delete(terrainCache.keys().next().value!);
    return { file };
  }

  /** The navmesh tile under a point, cached per session; null when it is missing or unreadable. */
  async function navTileAt(live: Session, dir: string, map: number, x: number, y: number): Promise<NavTile | null> {
    const name = navTileFileName(map, x, y);
    const cache = (live.navTiles ??= new Map());
    if (cache.has(name)) {
      const tile = cache.get(name)!;
      cache.delete(name);
      cache.set(name, tile);
      return tile;
    }
    const files = deps.mapDataFiles ?? deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
    let tile: NavTile | null = null;
    for (const folder of [join(dir, 'mmaps'), join(dir, '..', 'mmaps')]) {
      const bytes = await files.read(folder, name);
      if (!bytes) continue;
      try {
        tile = parseNavTile(bytes);
      } catch (error) {
        console.warn(`Navmesh: ${name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }
    cache.set(name, tile);
    if (cache.size > NAV_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return tile;
  }

  /**
   * The server's spell list for this session, read on first use rather than at connect: the file
   * is large and only fights need it. A missing folder or file becomes a reason, never a failure.
   */
  function spellsOf(live: Session): Promise<SpellIndex | { reason: string }> {
    live.spells ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return { reason: 'Spell names need the server data folder.' };
      const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
      try {
        const spell = await readServerDataFile(dir, SPELL_FILE, files);
        if (!spell) return { reason: `${SPELL_FILE} is not in ${dir} or its dbc folder.` };
        const [castTimes, ranges, overrides] = await Promise.all([
          readServerDataFile(dir, CAST_TIMES_FILE, files),
          readServerDataFile(dir, RANGE_FILE, files),
          rowsOrNone(live.db, 'spell_dbc', {}),
        ]);
        const index = readSpellIndex({ spell, castTimes, ranges, overrides });
        live.spellsReady = index;
        return index;
      } catch (error) {
        return { reason: `${SPELL_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}` };
      }
    })();
    return live.spells;
  }

  /** The server's sound names for this session, read on first use like the spell list. */
  function soundsOf(live: Session): Promise<SoundIndex | { reason: string }> {
    live.sounds ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return { reason: 'Sound names need the server data folder.' };
      try {
        const bytes = await readServerDataFile(dir, SOUND_FILE, deps.serverDataFiles ?? NO_SERVER_DATA_FILES);
        return bytes ? readSoundIndex(bytes) : { reason: `${SOUND_FILE} is not in ${dir} or its dbc folder.` };
      } catch (error) {
        return { reason: `${SOUND_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}` };
      }
    })();
    return live.sounds;
  }

  /** What vendors ask for besides gold, read on first use; item names come from the world database. */
  function extendedCostsOf(live: Session): Promise<ExtendedCostIndex | { reason: string }> {
    live.extendedCosts ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return { reason: 'Extended costs need the server data folder.' };
      try {
        const bytes = await readServerDataFile(dir, EXTENDED_COST_FILE, deps.serverDataFiles ?? NO_SERVER_DATA_FILES);
        if (!bytes) return { reason: `${EXTENDED_COST_FILE} is not in ${dir} or its dbc folder.` };
        const costs = readExtendedCosts(bytes);
        const items = [...new Set([...costs.values()].flatMap((c) => c.items.map((i) => i.item)))];
        const names = await live.db.lookupNames('item', items);
        return buildExtendedCostIndex(costs, (id) => names.get(id));
      } catch (error) {
        return { reason: `${EXTENDED_COST_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}` };
      }
    })();
    return live.extendedCosts;
  }

  /**
   * Quest log headings: zones from the server data folder, when it has them, and categories (from
   * `QuestSort.dbc`, or the stock list). A missing or unreadable file only loses its names.
   */
  function questSortsOf(live: Session): Promise<QuestSortIndex> {
    live.questSorts ??= (async () => {
      const dir = live.serverData?.status.dir;
      const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
      const read = async (name: string): Promise<Uint8Array | undefined> => {
        if (!dir) return undefined;
        try {
          return (await readServerDataFile(dir, name, files)) ?? undefined;
        } catch {
          return undefined;
        }
      };
      const [areas, maps, sorts] = await Promise.all([read(AREA_TABLE_FILE), read(MAP_FILE), read(QUEST_SORT_FILE)]);
      try {
        return readQuestSorts({ areas, maps, sorts });
      } catch {
        return readQuestSorts({});
      }
    })();
    return live.questSorts;
  }

  /** One of the look or faction indexes, read from the server data folder on first use. */
  function lookOf(live: Session, kind: LookKind): Promise<DisplayIndex | FactionTemplateIndex | { reason: string }> {
    const looks = (live.looks ??= {});
    looks[kind] ??= (async () => {
      const dir = live.serverData?.status.dir;
      if (!dir) return { reason: 'Looks and factions need the server data folder.' };
      const files = deps.serverDataFiles ?? NO_SERVER_DATA_FILES;
      const read = async (name: string): Promise<Uint8Array> => {
        const bytes = await readServerDataFile(dir, name, files);
        if (!bytes) throw new Error(`${name} is not in ${dir} or its dbc folder.`);
        return bytes;
      };
      try {
        if (kind === 'objectDisplay') return readObjectDisplays(await read(DISPLAY_FILES.objectDisplays));
        if (kind === 'factionTemplate') {
          const [templates, factions] = await Promise.all([read(FACTION_TEMPLATE_FILES.templates), read(FACTION_TEMPLATE_FILES.factions)]);
          return readFactionTemplates({ templates, factions });
        }
        const [displays, models, extras, races] = await Promise.all([
          read(DISPLAY_FILES.creatureDisplays), read(DISPLAY_FILES.creatureModels), read(DISPLAY_FILES.displayExtras), read(DISPLAY_FILES.races),
        ]);
        return readCreatureDisplays({ displays, models, extras, races });
      } catch (error) {
        return { reason: error instanceof Error ? error.message : String(error) };
      }
    })();
    return looks[kind]!;
  }

  const LOOK_KINDS: ReadonlySet<string> = new Set<LookKind>(['creatureDisplay', 'objectDisplay', 'factionTemplate']);
  const isLookKind = (kind: string): kind is LookKind => LOOK_KINDS.has(kind);
  /** How many names a look's "used by" lists. */
  const USED_BY_NAMES = 3;

  /** A look's hits, each with up to three NPCs or objects in the world that use it. */
  async function lookHits(live: Session, kind: LookKind, text: string): Promise<EntityHit[]> {
    const index = await lookOf(live, kind);
    if ('reason' in index) return [];
    if (kind === 'factionTemplate') return (index as FactionTemplateIndex).search(text, ENTITY_SEARCH_LIMIT);
    const hits = (index as DisplayIndex).search(text, ENTITY_SEARCH_LIMIT);
    if (hits.length === 0) return [];
    const ids = hits.map((h) => String(h.id));
    const users = new Map<number, string[]>();
    const note = (display: number, name: string): void => {
      const names = users.get(display) ?? [];
      if (names.length < USED_BY_NAMES && name) names.push(name);
      users.set(display, names);
    };
    if (kind === 'creatureDisplay') {
      const models = await rowsOrNone(live.db, 'creature_template_model', { CreatureDisplayID: ids });
      const entries = [...new Set(models.map((m) => Number(m.CreatureID)))].sort((a, b) => a - b);
      const names = await live.db.lookupNames('creature', entries);
      for (const entry of entries) {
        for (const m of models) if (Number(m.CreatureID) === entry) note(Number(m.CreatureDisplayID), names.get(entry) ?? '');
      }
    } else {
      const objects = await rowsOrNone(live.db, 'gameobject_template', { displayId: ids });
      for (const o of [...objects].sort((a, b) => Number(a.entry) - Number(b.entry))) note(Number(o.displayId), o.name ?? '');
    }
    return hits.map((h) => {
      const names = users.get(h.id) ?? [];
      return names.length > 0 ? { ...h, detail: `used by ${names.join(', ')}` } : h;
    });
  }
  return { terrainAt, navTileAt, spellsOf, soundsOf, extendedCostsOf, questSortsOf, lookOf, isLookKind, lookHits };
}

export type ServerFiles = ReturnType<typeof createServerFiles>;
