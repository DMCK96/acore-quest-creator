import type { Spawn } from '@core/entities/model';
import { newSpawn } from '@core/entities/model';
import { NumberField } from '../scripts/fields';
import { PositionInput } from '../scripts/PositionInput';
import { useMapOpener } from '../map/MapOpener';

/** A spawn with a route to walk: it patrols instead of wandering. */
const patrols = (spawn: Spawn): boolean => (spawn.patrol?.points.length ?? 0) >= 2;

/** Where a new NPC or object stands: one row per spawn, each with its own position and timing. */
export function SpawnList({
  idPrefix,
  ownerKey,
  spawns,
  wanders,
  onChange,
  allocate,
}: {
  idPrefix: string;
  /** Whose spawns these are, for their markers on the quest map. */
  ownerKey?: { kind: 'npc' | 'obj'; entry: number };
  spawns: readonly Spawn[];
  /** NPCs can wander around their spawn point; objects cannot. */
  wanders: boolean;
  onChange(next: Spawn[]): void;
  /** A fresh guid for a new spawn, or null when none could be had. */
  allocate(): Promise<number | null>;
}): React.JSX.Element {
  const openMap = useMapOpener();
  const set = (i: number, spawn: Spawn): void => onChange(spawns.map((s, j) => (j === i ? spawn : s)));

  async function add(): Promise<void> {
    const guid = await allocate();
    if (guid === null) return;
    // A new spawn starts where the last one stands: most spawns of one NPC are close together.
    const last = spawns.at(-1);
    // A copied patrol would share its pinned path with the spawn it came from.
    onChange([...spawns, last ? { ...last, guid, patrol: null } : newSpawn(guid)]);
  }

  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Where it stands</h4>
      {spawns.length === 0 && <p className="scene-hint">Not placed in the world yet.</p>}
      <ol className="scene-steps">
        {spawns.map((spawn, i) => (
          <li key={spawn.guid} className="scene-step">
            <div className="scene-step__head">
              <strong>Spawn {i + 1}</strong>
              <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(spawns.filter((_, j) => j !== i))}>
                Remove spawn
              </button>
            </div>
            <NumberField label="Map" value={spawn.map} onChange={(map) => set(i, { ...spawn, map })} />
            <PositionInput
              idPrefix={`${idPrefix}-spawn${i}`}
              value={{ x: spawn.x, y: spawn.y, z: spawn.z, o: spawn.o }}
              map={spawn.map}
              markerId={ownerKey ? `spawn:${ownerKey.kind}:${ownerKey.entry}:${spawn.guid}` : undefined}
              onChange={(p, map) => set(i, { ...spawn, ...p, map: map ?? spawn.map })}
            />
            <NumberField label="Respawn (seconds)" value={spawn.respawnSecs} min={0} onChange={(respawnSecs) => set(i, { ...spawn, respawnSecs: Math.round(respawnSecs) })} />
            {wanders && !patrols(spawn) && (
              <NumberField label="Wander (yards)" value={spawn.wander} min={0} onChange={(wander) => set(i, { ...spawn, wander })} />
            )}
            {ownerKey?.kind === 'npc' && openMap && (
              <div className="scene-row">
                {patrols(spawn) && <p className="scene-hint">Walks a patrol of {spawn.patrol!.points.length} points.</p>}
                <button type="button" className="entry-card__btn"
                  onClick={() => openMap({ kind: 'patrol', entry: ownerKey.entry, guid: spawn.guid })}>
                  {patrols(spawn) ? 'Edit patrol' : 'Draw patrol'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => void add()}>
        Add spawn
      </button>
      {spawns.length === 0 && ownerKey && openMap && (
        <button type="button" className="btn"
          onClick={() => openMap({ kind: 'place', target: { kind: ownerKey.kind === 'npc' ? 'npc' : 'object', entry: ownerKey.entry } })}>
          Place on map
        </button>
      )}
    </div>
  );
}
