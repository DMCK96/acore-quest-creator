import { areaOverview } from '../../core/lore/area';
import { checkIds, checkNames } from '../../core/lore/names';
import { questsInZone, questSummaries } from '../../core/lore/quests';
import type { ProjectNames } from '../../core/lore/types';
import { WikiError, createWikiClient } from '../../core/lore/wiki';
import type { FactionTemplateIndex } from '../../core/game/faction-templates';
import type { LoreApi } from '../../shared/ipc';
import type { ApiDeps } from './deps';
import type { Services } from './services';
import { fail, run } from './errors';

/** Read-only questions about the world, and lookups on the Warcraft wiki */
export function createLoreApi(s: Services, deps: ApiDeps): LoreApi {
  const { connected, projectEntities } = s.ctx;
  const { questSortsOf, lookOf } = s.files;

  // One wiki client for the life of the API, so its cache lasts the session
  let wiki: ReturnType<typeof createWikiClient> | null = null;
  const wikiClient = () => {
    if (!deps.mcp?.wikiEnabled()) {
      throw fail('NOT_ENABLED', 'Wiki lookups are turned off. Turn on "Allow lookups on warcraft.wiki.gg" in Settings, MCP / AI tab.');
    }
    if (!deps.fetch) throw fail('QUERY', 'This build cannot reach the internet.');
    wiki ??= createWikiClient({ fetch: deps.fetch });
    return wiki;
  };
  const viaWiki = async <T,>(work: (client: ReturnType<typeof createWikiClient>) => Promise<T>): Promise<T> => {
    const client = wikiClient();
    try {
      return await work(client);
    } catch (error) {
      if (error instanceof WikiError) throw fail('QUERY', error.message);
      throw error;
    }
  };

  const projectNames = (): ProjectNames => {
    const store = projectEntities();
    return {
      creature: store.npcs.map((e) => ({ id: e.entry, name: e.name })),
      gameobject: store.objects.map((e) => ({ id: e.entry, name: e.name })),
      item: store.items.map((e) => ({ id: e.entry, name: e.name })),
      quest: deps.session.quests
        .list()
        .map((q) => ({ id: q.questId, name: String(q.aggregate.values['quest_template.LogTitle'] ?? '') }))
        .filter((q) => q.name.trim() !== ''),
    };
  };

  return {
    questsInZone: (zone, filter) =>
      run(async () => {
        const live = connected();
        const name = (await questSortsOf(live)).get(zone) ?? (zone < 0 ? `Category ${-zone}` : `Zone ${zone}`);
        return questsInZone(live.db, { id: zone, name }, filter ?? {});
      }),

    questSummaries: (questIds) =>
      run(async () => {
        const live = connected();
        const zones = await questSortsOf(live);
        return questSummaries(live.db, questIds, (id) => zones.get(id));
      }),

    areaOverview: (map, x, y, radius) =>
      run(async () => {
        const live = connected();
        if (!live.db.spawnsForView) throw fail('QUERY', 'This database connection cannot list spawns.');
        const factions = await lookOf(live, 'factionTemplate');
        const factionName = (template: number): string | undefined => ('reason' in factions ? undefined : (factions as FactionTemplateIndex).get(template)?.name);
        return areaOverview(live.db, { map, x, y, radius }, { faction: factionName });
      }),

    checkNames: (kind, names) => run(async () => checkNames(connected().db, projectNames(), kind, names)),

    checkIds: (kind, ids) => run(async () => checkIds(connected().db, projectNames(), kind, ids)),

    wikiSearch: (text, limit) => run(() => viaWiki((client) => client.search(text, limit))),

    wikiPage: (title, section) => run(() => viaWiki((client) => client.page(title, section))),
  };
}
