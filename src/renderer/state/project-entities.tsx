import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ProjectEntities } from '@core/entities/model';
import { trackedEntities } from '@core/entities/tracked';
import type { EntityRef, TrackedEntity } from '@core/entities/entity';
import type { WorldLayer } from '@core/world/layer';
import { questRefs, questUses, type QuestUse } from '@core/entities/links';
import type { Api } from '@shared/ipc';
import type { AppStore } from './app-store';

/** A project quest as the NPC, object and item views need it: its name and what it uses */
export interface ProjectQuestUse {
  questId: number;
  title: string;
  uses: QuestUse;
  /** Everything it references, whether or not the project has it */
  refs: QuestUse;
}

/**
 * The project's new NPCs, objects and items for the views that show and edit them (the quest's panel,
 * the editors, the World): the store, how to change it, the quests that use what, and how to make one.
 */
export interface ProjectEntitiesValue {
  entities: ProjectEntities;
  setEntities(next: ProjectEntities): void;
  quests: ProjectQuestUse[];
  /** The project's changes to the world */
  layer: WorldLayer;
  setLayer(layer: WorldLayer): void;
  /** Every NPC, object and item the project tracks: new, changed or placed */
  tracked: TrackedEntity[];
  create: ReturnType<AppStore['getState']>['createEntity'];
  /** Deletes one, emptying the giver cards that named it, as one step; the error to show, or null */
  remove(kind: 'npc' | 'object' | 'item', entry: number): Promise<string | null>;
  /** Brings one the database already has into the store as one step (one there already is left be) */
  adopt: ReturnType<AppStore['getState']>['adoptEntity'];
  /** Makes sure one is in the store, adopting it from the database when it is not; the error to show, or null */
  ensure(ref: EntityRef): Promise<string | null>;
}

/** Whether the store has an NPC, object or item */
export function storeHas(entities: ProjectEntities, ref: EntityRef): boolean {
  const list = ref.kind === 'npc' ? entities.npcs : ref.kind === 'object' ? entities.objects : entities.items;
  return list.some((e) => e.entry === ref.entry);
}

/** `ensure` built from the store's current state and `adopt` */
export function ensureWith(current: () => ProjectEntities, adopt: ProjectEntitiesValue['adopt']): ProjectEntitiesValue['ensure'] {
  return async (ref) => {
    if (storeHas(current(), ref)) return null;
    const adopted = await adopt(ref.kind, ref.entry);
    return 'error' in adopted ? adopted.error : null;
  };
}

const ProjectEntitiesContext = createContext<ProjectEntitiesValue | null>(null);

export function ProjectEntitiesProvider({ value, children }: { value: ProjectEntitiesValue; children: ReactNode }): React.JSX.Element {
  return <ProjectEntitiesContext.Provider value={value}>{children}</ProjectEntitiesContext.Provider>;
}

/** The project's NPCs, objects and items, or null outside a project */
export function useProjectEntities(): ProjectEntitiesValue | null {
  return useContext(ProjectEntitiesContext);
}

/** The quests other than `questId` that use an entity, by title */
export function otherUsers(quests: readonly ProjectQuestUse[], questId: number | null, kind: keyof QuestUse, entry: number): string[] {
  return quests.filter((q) => q.questId !== questId && q.uses[kind].includes(entry)).map((q) => q.title.trim() || `Quest ${q.questId}`);
}

/**
 * The provider as the app store feeds it: the store, and the quests that use what is in it (the open
 * quest as it is being edited, the rest as the graph lists them)
 */
export function ProjectEntitiesFromStore({ store, children }: { store: AppStore; children: ReactNode }): React.JSX.Element {
  const entities = store((s) => s.entities);
  const nodes = store((s) => s.nodes);
  const open = store((s) => s.open);
  const layer = store((s) => s.layer);
  const value = useMemo((): ProjectEntitiesValue => {
    const quests = nodes.map((n) => ({ questId: n.questId, title: n.title, uses: n.uses, refs: n.refs }));
    if (open) {
      const title = open.aggregate.values['quest_template.LogTitle'];
      const like = { questId: open.questId, aggregate: open.aggregate };
      const mine = { questId: open.questId, title: typeof title === 'string' ? title : '', uses: questUses(like, entities), refs: questRefs(like) };
      const at = quests.findIndex((q) => q.questId === open.questId);
      if (at >= 0) quests[at] = mine;
      else quests.push(mine);
    }
    const { setEntities, createEntity, deleteEntity, adoptEntity, setLayer } = store.getState();
    const tracked = trackedEntities({ store: entities, layer, quests });
    const ensure = ensureWith(() => store.getState().entities, adoptEntity);
    return { entities, setEntities, quests, layer, setLayer, tracked, create: createEntity, remove: deleteEntity, adopt: adoptEntity, ensure };
  }, [store, nodes, open, entities, layer]);
  return <ProjectEntitiesProvider value={value}>{children}</ProjectEntitiesProvider>;
}

/**
 * The api the pickers search with: an NPC, object or item edit still waiting to be sent is sent first,
 * so a search typed straight after naming one finds it by its new name.
 */
export function searchingFresh(api: Api, flush: () => Promise<void>): Api {
  return {
    ...api,
    searchEntities: async (kind, text) => {
      await flush();
      return api.searchEntities(kind, text);
    },
  };
}
