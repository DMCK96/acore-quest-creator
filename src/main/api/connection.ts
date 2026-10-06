import type { ColumnInfo, SchemaInfo } from '../../core/db/types';
import type { WorldDb } from '../../core/db/world-db';
import type { Availability } from '../../core/links/availability';
import type { ItemStarter } from '../../core/links/context';
import { registry } from '../../core/registry';
import type { NavTile } from '../../core/game/navmesh';
import type { ServerData } from '../server-data';
import type { SpellIndex } from '../../core/game/spells';
import type { SoundIndex } from '../../core/game/sounds';
import type { QuestSortIndex } from '../../core/game/quest-sorts';
import type { DisplayIndex } from '../../core/game/displays';
import type { FactionTemplateIndex } from '../../core/game/faction-templates';
import type { LookKind } from '../../core/db/entity-search';
import type { ApiDeps } from './deps';
import { fail } from './errors';

/** The live world connection plus everything that was read from it once, at connect time. */
export interface Session {
  profileId: number;
  /** The connection's export folder; null when it names none. */
  exportDir: string | null;
  db: WorldDb;
  schema: SchemaInfo;
  blocking: boolean;
  blockingTables: string[];
  /** Blocking tables the database has but will not show this user: a grant, not a missing table. */
  forbiddenTables: string[];
  /** The tables quest links read beyond the registry's, as the connected database has them. */
  contextTables: Record<string, ColumnInfo[]>;
  /** Which link components this database can carry, decided once so every call agrees. */
  availability: Availability;
  /** Every quest-starting item, read once here because asking `item_template` per link read is a full scan. */
  itemStarters: ItemStarter[];
  /** What the profile's server data folder added, read once at connect; null when it names none. */
  serverData: ServerData | null;
  /** The tables quest scripting writes, as this database has them. */
  scriptSchema: SchemaInfo;
  /** The spell list, loaded on the first spell search or lookup; a reason when there is none. */
  spells?: Promise<SpellIndex | { reason: string }>;
  /** The spell list once loaded, for checks that must not wait for or start a load. */
  spellsReady?: SpellIndex;
  /** Sound names, loaded on the first sound search or lookup; a reason when there are none. */
  sounds?: Promise<SoundIndex | { reason: string }>;
  questSorts?: Promise<QuestSortIndex>;
  /** Looks and factions for new NPCs and objects, each loaded on first use. */
  looks?: Partial<Record<LookKind, Promise<DisplayIndex | FactionTemplateIndex | { reason: string }>>>;
  /** Parsed navmesh tiles by file name (null when missing or unreadable), most recent last. */
  navTiles?: Map<string, NavTile | null>;
}

/** The live world connection: none until the first connect, replaced whole by each one after */
export interface Connection {
  /** The live connection; null before the first connect */
  current(): Session | null;
  set(next: Session): void;
  /** The live connection; refused before the first connect */
  connected(): Session;
  /** A connection whose schema can actually carry a quest: drift that blocks is refused */
  usable(): Session;
  /** The game client folder the 3D view was last told */
  clientDir(): string | null;
  /** Tells the 3D view's file service a new game client folder */
  setClientDir(next: string | null): void;
}

/** The connection a fresh API starts with: none */
export function createConnection(deps: ApiDeps): Connection {
  let session: Session | null = null;
  // The client folder last told, so a connect that fails part way can put it back.
  let clientDir: string | null = null;
  const setClientDir = (next: string | null): void => {
    clientDir = next;
    deps.onClientDir?.(next);
  };

  const connected = (): Session => {
    if (!session) throw fail('NOT_CONNECTED', 'Connect to a world database first.');
    return session;
  };

  /** A connection whose schema can actually carry a quest: drift that blocks is refused here. */
  const usable = (): Session => {
    const live = connected();
    if (!live.blocking) return live;
    const forbidden = live.blockingTables.filter((t) => live.forbiddenTables.includes(t));
    // "Missing" and "you may not read it" need different fixes, so they get different sentences.
    if (forbidden.length > 0) {
      throw fail(
        'PERMISSION',
        `The connected database has ${forbidden.join(', ')} but this user may not read ${forbidden.length > 1 ? 'them' : 'it'}. Grant it SELECT and reconnect.`,
      );
    }
    throw fail(
      'BLOCKING_DRIFT',
      `The connected database is missing ${live.blockingTables.join(', ')}, which every quest needs. Reconnect to a database that has it.`,
    );
  };

  return {
    current: () => session,
    set: (next) => {
      session = next;
    },
    connected,
    usable,
    clientDir: () => clientDir,
    setClientDir,
  };
}
