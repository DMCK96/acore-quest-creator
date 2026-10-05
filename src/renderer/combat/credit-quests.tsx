import { createContext, useContext, type ReactNode } from 'react';
import type { Fight } from '@core/combat/model';

/** The quests a fight's credit step can name, and the one a new credit step names */
export interface CreditQuests {
  quests: readonly { questId: number; title: string }[];
  defaultQuest: number;
}

const CreditQuestsContext = createContext<CreditQuests>({ quests: [], defaultQuest: 0 });

export function CreditQuestsProvider({ value, children }: { value: CreditQuests; children: ReactNode }): React.JSX.Element {
  return <CreditQuestsContext.Provider value={value}>{children}</CreditQuestsContext.Provider>;
}

export function useCreditQuests(): CreditQuests {
  return useContext(CreditQuestsContext);
}

/** The fight with every credit step that names no quest given `quest` (a preset's, or one saved before) */
export function creditingQuest(fight: Fight | null, quest: number): Fight | null {
  if (!fight || quest === 0) return fight;
  return {
    ...fight,
    reactions: fight.reactions.map((r) => ({ ...r, steps: r.steps.map((s) => (s.kind === 'credit' && s.quest === 0 ? { ...s, quest } : s)) })),
  };
}
