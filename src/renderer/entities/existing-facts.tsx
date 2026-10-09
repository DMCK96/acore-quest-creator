import type { EntityLock } from '@core/entities/model';

/** What the editors say about an existing entity, counted when it was first edited */
export interface ExistingFacts {
  /** Other templates sharing its loot list */
  sharedLoot: number;
  spawnCount: number;
  /** Other NPCs using its trainer */
  sharedTrainer?: number;
  /** Parts left as the database has them */
  locked: readonly EntityLock[];
}

/** The Loot tab's body: a warning when others share the list, or only a line when it is not edited here */
export function ExistingLoot({ existing, children }: { existing?: ExistingFacts; children: React.ReactNode }): React.JSX.Element {
  if (existing?.locked.includes('loot')) return <p className="scene-hint">Its loot list uses references or groups, which are not edited here.</p>;
  return (
    <>
      {existing && existing.sharedLoot > 0 && (
        <p className="scene-hint">{existing.sharedLoot} {existing.sharedLoot === 1 ? 'other shares' : 'others share'} this loot list: changing it changes theirs too.</p>
      )}
      {children}
    </>
  );
}
