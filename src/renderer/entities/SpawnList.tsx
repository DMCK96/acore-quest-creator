import type { Spawn } from '@core/entities/model';
import { newSpawn } from '@core/entities/model';
import { NumberField } from '../scripts/fields';
import { PositionInput } from '../scripts/PositionInput';

/** Where a new NPC or object stands: one row per spawn, each with its own position and timing. */
export function SpawnList({
  idPrefix,
  spawns,
  wanders,
  onChange,
  allocate,
}: {
  idPrefix: string;
  spawns: readonly Spawn[];
  /** NPCs can wander around their spawn point; objects cannot. */
  wanders: boolean;
  onChange(next: Spawn[]): void;
  /** A fresh guid for a new spawn, or null when none could be had. */
  allocate(): Promise<number | null>;
}): React.JSX.Element {
  const set = (i: number, spawn: Spawn): void => onChange(spawns.map((s, j) => (j === i ? spawn : s)));

  async function add(): Promise<void> {
    const guid = await allocate();
    if (guid === null) return;
    // A new spawn starts where the last one stands: most spawns of one NPC are close together.
    const last = spawns.at(-1);
    onChange([...spawns, last ? { ...last, guid } : newSpawn(guid)]);
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
              onChange={(p, map) => set(i, { ...spawn, ...p, map: map ?? spawn.map })}
            />
            <NumberField label="Respawn (seconds)" value={spawn.respawnSecs} min={0} onChange={(respawnSecs) => set(i, { ...spawn, respawnSecs: Math.round(respawnSecs) })} />
            {wanders && <NumberField label="Wander (yards)" value={spawn.wander} min={0} onChange={(wander) => set(i, { ...spawn, wander })} />}
          </li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => void add()}>
        Add spawn
      </button>
    </div>
  );
}
