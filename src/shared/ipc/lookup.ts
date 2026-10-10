import type { RefKind } from '@core/db/types';
import type { EntityHit, QuestSummary, SearchKind } from '@core/db/world-db';
import type { SpellFacts } from '@core/game/spells';
import type { Result } from './result';

/** A quest an NPC starts or ends. */
export interface NpcQuest {
  id: number;
  title: string;
  /** 'project' when the project's own copy of the quest says so (new or changed, not yet in the database) */
  source?: 'project';
}

/** What `spellFacts` answers: the spells found, or why spell names are not available. */
export interface SpellFactsResult {
  available: boolean;
  reason?: string;
  spells: Record<number, SpellFacts>;
}

/** Searches and names: quests, NPCs, objects, items, spells, sounds, looks, rewards and events */
export interface LookupApi {
  searchQuests(text: string): Promise<Result<(QuestSummary & { source?: 'project' })[]>>;
  /** The quests an NPC starts and the quests it ends, by the database's own giver tables. */
  questsOfNpc(entry: number): Promise<Result<{ starts: NpcQuest[]; ends: NpcQuest[] }>>;
  /** Items, NPCs, objects or quests whose name contains the text, or whose ID is it. */
  searchEntities(kind: SearchKind, text: string): Promise<Result<EntityHit[]>>;
  lookupNames(kind: RefKind, ids: number[]): Promise<Result<Record<number, string>>>;
  /** The XP and money a quest of this level rewards, one entry per reward index. */
  rewardTables(level: number): Promise<Result<{ xp: (number | null)[]; money: (number | null)[] }>>;
  /** Facts of the spells the server's spell list has, or why there is no list (no server data folder, unreadable file). */
  spellFacts(ids: number[]): Promise<Result<SpellFactsResult>>;
  /** The game events in the database, by id, with their descriptions as names. */
  gameEvents(): Promise<Result<{ id: number; name: string }[]>>;
}
