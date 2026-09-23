import { createContext, useContext, type ReactNode } from 'react';
import type { QuestAggregate } from '@core/model/aggregate';

const AggregateContext = createContext<QuestAggregate | null>(null);

/** Makes the quest under edit available to controls nested anywhere inside a module panel. */
export function AggregateProvider({
  aggregate,
  children,
}: {
  aggregate: QuestAggregate;
  children: ReactNode;
}): React.JSX.Element {
  return <AggregateContext.Provider value={aggregate}>{children}</AggregateContext.Provider>;
}

/**
 * Reads the quest aggregate from the nearest `AggregateProvider`.
 *
 * Controls such as `XpDifficultyControl` need fields other than their own (the quest level, to
 * label the difficulty options), which `ControlProps` does not carry; this is how they reach them.
 */
export function useAggregate(): QuestAggregate {
  const aggregate = useContext(AggregateContext);
  if (!aggregate) throw new Error('useAggregate must be used within an AggregateProvider');
  return aggregate;
}
