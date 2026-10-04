import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectEntities } from '@core/entities/model';
import type { QuestUse } from '@core/entities/links';
import type { AppStore } from './app-store';

/** A project quest as the NPC, object and item views need it: its name and what it uses */
export interface ProjectQuestUse {
  questId: number;
  title: string;
  uses: QuestUse;
}

/**
 * The project's new NPCs, objects and items for the views that show and edit them (the quest's panel,
 * the editors, the World): the store, how to change it, the quests that use what, and how to make one.
 */
export interface ProjectEntitiesValue {
  entities: ProjectEntities;
  setEntities(next: ProjectEntities): void;
  quests: ProjectQuestUse[];
  create: ReturnType<AppStore['getState']>['createEntity'];
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
