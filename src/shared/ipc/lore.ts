import type {
  AreaOverview,
  IdCheck,
  NameCheck,
  NameKind,
  QuestSummaries,
  WikiPageResult,
  WikiSearchResult,
  ZoneQuests,
} from '@core/lore/types';
import type { Result } from './result';

export type * from '@core/lore/types';

/** Read-only questions about what already exists in the world, and lookups on the Warcraft wiki */
export interface LoreApi {
  /** The quests listed under a zone (a quest log zone id), by level, with an optional level range and limit (default 50, at most 200). */
  questsInZone(zone: number, filter?: { minLevel?: number; maxLevel?: number; limit?: number }): Promise<Result<ZoneQuests>>;
  /** Quests read as text and facts without importing them (at most 25); ids the database lacks come back in `missing`. */
  questSummaries(questIds: number[]): Promise<Result<QuestSummaries>>;
  /** The NPCs, objects, quests and factions around a point on a map (world yards, radius at most 500), with where each stands and faces. */
  areaOverview(map: number, x: number, y: number, radius: number): Promise<Result<AreaOverview>>;
  /** For each name, what already has it (or one like it) in the database and the project. */
  checkNames(kind: NameKind, names: string[]): Promise<Result<NameCheck[]>>;
  /** For each id, whether the database and the project already have it. */
  checkIds(kind: NameKind, ids: number[]): Promise<Result<IdCheck[]>>;
  /** Searches warcraft.wiki.gg; needs the wiki switch in Settings (MCP / AI) to be on. */
  wikiSearch(text: string, limit?: number): Promise<Result<WikiSearchResult>>;
  /** Reads one wiki page, or one section of it; needs the wiki switch to be on. */
  wikiPage(title: string, section?: string): Promise<Result<WikiPageResult>>;
}
