import { useName } from '../state/names';

/** What the chosen look is, in words: "Looks like: Human male · armoured (display 3167)". */
export function LookLine({ kind, displayId, hasServerData = true }: {
  kind: 'creatureDisplay' | 'objectDisplay';
  displayId: number;
  /** Without the server data folder no look has a name, which says nothing about the display. */
  hasServerData?: boolean;
}): React.JSX.Element | null {
  const { state, name } = useName(kind, displayId);
  if (displayId <= 0) return null;
  if (!hasServerData) return <p className="scene-hint">Looks like: display {displayId} (its name needs the server data folder)</p>;
  if (state === 'found' && name) return <p className="scene-hint">Looks like: {name} (display {displayId})</p>;
  if (state === 'missing' || state === 'unsupported') return <p className="scene-hint">Looks like: Display {displayId} (not in the server&apos;s data)</p>;
  return <p className="scene-hint">Looks like: display {displayId}</p>;
}
