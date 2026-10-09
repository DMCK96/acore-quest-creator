import { useState } from 'react';
import { trainerUnread, type CustomNpc, type Trainer } from '@core/entities/model';
import { CopyTrainer, NO_TRAINER_ID } from './CopyTrainer';
import { TrainerList, TrainerSpells } from './TrainerList';

const NEW_TRAINER = { type: 'class', requirement: 0, greeting: '', spells: [] } as const;

/** How many of the fork's older shared lists (`npc_trainer`) an NPC also uses: each list it includes, and its own spells there */
function legacyLists(npc: CustomNpc): number {
  if (npc.origin.kind !== 'existing') return 0;
  const rows = npc.origin.original.npc_trainer ?? [];
  const includes = new Set(rows.filter((r) => Number(r.SpellID) < 0).map((r) => r.SpellID));
  return includes.size + (rows.some((r) => Number(r.SpellID) > 0) ? 1 : 0);
}

/** The Trainer tab's body: make the NPC a trainer, edit what it teaches, or give it its own copy of a shared trainer */
export function TrainerTab({ npc, onChange, allocateTrainer }: { npc: CustomNpc; onChange(next: CustomNpc): void; allocateTrainer(): Promise<number | null> }): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const name = npc.name.trim() || `NPC ${npc.entry}`;
  const idPrefix = `npc-${npc.entry}`;

  // A trainer a project saved before trainers (or a fork without the tables) never read is not ours to write
  if (trainerUnread(npc)) {
    return (
      <p className="scene-hint">
        {name}&apos;s trainer was not read when it was added to this project, so it is not edited here. Choose Put back as the database has it, then edit it again, to read it.
      </p>
    );
  }

  const remove = (trainer: Trainer): void => {
    if (trainer.spells.length > 0 && !window.confirm(`Make ${name} stop teaching its ${trainer.spells.length} spell${trainer.spells.length === 1 ? '' : 's'}?`)) return;
    onChange({ ...npc, trainer: null });
  };

  const lists = legacyLists(npc);
  const note = lists > 0 && (
    <p className="scene-hint">Also teaches the spells of {lists} shared list{lists === 1 ? '' : 's'} (the older npc_trainer table), which are not edited here.</p>
  );
  const alert = error && <p role="alert" className="control__alert">{error}</p>;
  const locked = npc.origin.kind === 'existing' && npc.origin.locked.includes('trainer');

  if (locked && npc.origin.kind === 'existing') {
    const origin = npc.origin;
    if (!npc.trainer) return <><p className="scene-hint">{name}&apos;s trainer is one this editor does not edit.</p>{note}</>;
    const trainer = npc.trainer;
    const others = origin.sharedTrainer ?? 0;
    const ownCopy = async (): Promise<void> => {
      setError(null);
      const trainerId = await allocateTrainer();
      if (trainerId === null) {
        setError(NO_TRAINER_ID);
        return;
      }
      onChange({ ...npc, trainer: { ...trainer, trainerId }, origin: { ...origin, locked: origin.locked.filter((l) => l !== 'trainer') } });
    };
    return (
      <div className="scene-section">
        <p className="scene-hint">
          {others > 0 ? `${others} other NPC${others === 1 ? ' uses' : 's use'} this trainer` : 'Other NPCs use this trainer'}: changing it would change theirs too.
        </p>
        <TrainerSpells trainer={trainer} />
        <button type="button" className="btn" onClick={() => void ownCopy()}>
          Give it its own copy
        </button>
        <button type="button" className="btn" onClick={() => remove(trainer)}>
          Remove trainer
        </button>
        {alert}
        {note}
      </div>
    );
  }

  const make = async (): Promise<void> => {
    setError(null);
    const trainerId = await allocateTrainer();
    if (trainerId === null) {
      setError(NO_TRAINER_ID);
      return;
    }
    onChange({ ...npc, trainer: { trainerId, ...NEW_TRAINER, spells: [] } });
  };
  return (
    <>
      {npc.trainer ? (
        <>
          <TrainerList idPrefix={idPrefix} trainer={npc.trainer} onChange={(trainer) => onChange({ ...npc, trainer })} />
          <button type="button" className="btn" onClick={() => remove(npc.trainer!)}>
            Remove trainer
          </button>
        </>
      ) : (
        <div className="scene-section">
          <h4 className="scene-section__title">Trainer</h4>
          <p className="scene-hint">This NPC teaches nothing.</p>
          <button type="button" className="btn" onClick={() => void make()}>
            Make this NPC a trainer
          </button>
        </div>
      )}
      {alert}
      <CopyTrainer idPrefix={idPrefix} npcEntry={npc.entry} current={npc.trainer} allocate={allocateTrainer} onCopy={(trainer) => onChange({ ...npc, trainer })} />
      {note}
    </>
  );
}
