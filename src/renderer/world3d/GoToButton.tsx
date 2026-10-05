import { useHasSpawn } from './useHasSpawn';
import type { ShowInWorld } from './ShowInWorldContext';

/** Go to beside an NPC or object: disabled, and saying why, once it is known to have no spawn. */
export function GoToButton({ questId, kind, entry, name, showInWorld }: {
  questId: number; kind: 'creature' | 'gameobject'; entry: number; name: string; showInWorld: ShowInWorld;
}): React.JSX.Element {
  const placed = useHasSpawn(kind, entry);
  const none = 'No spawn in the world yet';
  return (
    <button type="button" className="entry-card__btn" title={placed ? 'Show in World' : none}
      aria-label={`Go to ${name}`} aria-description={placed ? undefined : none} disabled={!placed}
      onClick={() => showInWorld({ questId, kind, entry })}>
      Go to
    </button>
  );
}
