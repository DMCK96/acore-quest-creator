import { useState } from 'react';
import { trainerUnread, type CustomNpc, type Trainer } from '@core/entities/model';
import { EntityField } from '../scripts/fields';
import { useApi } from '../state/names';
import { useProjectEntities } from '../state/project-entities';

export const NO_TRAINER_ID = 'Could not get a free trainer id.';

/** "Copy spells from…": replaces an NPC's trainer (type, class, greeting and spells) with another NPC's, new or from the database; the trainer id stays its own */
export function CopyTrainer({
  idPrefix, npcEntry, current, allocate, onCopy,
}: { idPrefix: string; npcEntry: number; current: Trainer | null; allocate(): Promise<number | null>; onCopy(next: Trainer): void }): React.JSX.Element {
  const api = useApi();
  const project = useProjectEntities();
  const [source, setSource] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function copy(): Promise<void> {
    setError(null);
    if (source === npcEntry) {
      setError('That is this NPC.');
      return;
    }
    // A project NPC whose trainer was never read has none to copy: the database's is read instead
    let from: CustomNpc | undefined = project?.entities.npcs.find((n) => n.entry === source);
    if (from && trainerUnread(from)) from = undefined;
    if (!from) {
      if (!api) {
        setError('Copying from the database needs the world database.');
        return;
      }
      const read = await api.readExistingEntity('npc', source);
      if (!read.ok) {
        setError(read.error.message);
        return;
      }
      from = read.value as CustomNpc;
    }
    if (!from.trainer) {
      setError('That NPC is not a trainer.');
      return;
    }
    const name = from.name.trim() || `NPC ${source}`;
    const had = current?.spells.length ?? 0;
    if (had > 0 && !window.confirm(`Replace this NPC's ${had} spell${had === 1 ? '' : 's'} with the ${from.trainer.spells.length} from ${name}?`)) return;
    const trainerId = current?.trainerId ?? (await allocate());
    if (trainerId === null) {
      setError(NO_TRAINER_ID);
      return;
    }
    const { type, requirement, greeting, spells } = from.trainer;
    onCopy({ trainerId, type, requirement, greeting, spells: spells.map((s) => ({ ...s, reqSpells: [...s.reqSpells] })) });
    setSource(0);
  }

  return (
    <div className="scene-section">
      <EntityField id={`${idPrefix}-copy-trainer`} label="Copy spells from…" kind="creature" value={source} onChange={setSource} />
      <button type="button" className="btn" disabled={source === 0} onClick={() => void copy()}>
        Copy
      </button>
      {error && <p role="alert" className="control__alert">{error}</p>}
    </div>
  );
}
