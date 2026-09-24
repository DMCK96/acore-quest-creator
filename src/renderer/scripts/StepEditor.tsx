import { stepOwners, type OwnerKind, type Position, type SceneStep, type StepKind } from '@core/scripts/model';
import { CheckField, EntityField, NumberField, SelectField, TextField } from './fields';
import { PositionInput } from './PositionInput';

/** What each step is called in the "Add step" list. */
export const STEP_LABELS: Record<StepKind, string> = {
  say: 'Say something',
  emote: 'Play an emote',
  credit: 'Give credit for an objective',
  eventCredit: "Complete the quest's event objective",
  failQuest: 'Fail the quest',
  castOnPlayer: 'Cast a spell on the player',
  castOnSelf: 'Cast a spell on itself',
  giveItem: 'Give the player an item',
  takeItem: 'Take an item from the player',
  spawnNpc: 'Spawn an NPC',
  spawnObject: 'Spawn an object',
  despawn: 'Despawn',
  moveTo: 'Move to a point',
  startEscort: 'Start an escort',
  npcFlags: 'Switch quest-giver or talking on or off',
  faction: 'Change faction',
  objectState: 'Open or close an object',
  signal: 'Tell another NPC or object',
  closeGossip: 'Close the talk window',
};

const STEP_ORDER = Object.keys(STEP_LABELS) as StepKind[];

/** The steps an owner of this kind can run, in list order. */
export function stepsFor(kind: OwnerKind): StepKind[] {
  return STEP_ORDER.filter((s) => stepOwners(s).includes(kind));
}

const ORIGIN: Position = { x: 0, y: 0, z: 0, o: 0 };

/** A step of this kind with its fields at their starting values. */
export function defaultStep(kind: StepKind): SceneStep {
  const w = { waitMs: 0 };
  switch (kind) {
    case 'say':
      return { kind, text: '…', style: 'say', ...w };
    case 'emote':
      return { kind, emote: 1, ...w };
    case 'credit':
      return { kind, objective: 1, group: false, ...w };
    case 'eventCredit':
      return { kind, group: false, ...w };
    case 'castOnPlayer':
    case 'castOnSelf':
      return { kind, spellId: 0, ...w };
    case 'giveItem':
    case 'takeItem':
      return { kind, item: 0, count: 1, ...w };
    case 'spawnNpc':
      return { kind, entry: 0, at: ORIGIN, despawnAfterS: 60, attackPlayer: false, ...w };
    case 'spawnObject':
      return { kind, entry: 0, at: ORIGIN, despawnAfterS: 60, ...w };
    case 'despawn':
      return { kind, entry: 0, range: 30, ...w };
    case 'moveTo':
      return { kind, at: ORIGIN, ...w };
    case 'startEscort':
      return { kind, points: [], run: false, ...w };
    case 'npcFlags':
      return { kind, questGiver: 'keep', gossip: 'keep', ...w };
    case 'faction':
      return { kind, faction: 0, ...w };
    case 'objectState':
      return { kind, state: 'open', entry: 0, range: 30, ...w };
    case 'signal':
      return { kind, signal: 1, targetKind: 'creature', entry: 0, range: 30, ...w };
    case 'failQuest':
    case 'closeGossip':
      return { kind, ...w };
  }
}

const TOGGLES = [['keep', 'Leave as it is'], ['on', 'On'], ['off', 'Off']] as const;

/** One step's own fields, below its wait. */
export function StepFields({ idPrefix, step, onChange }: { idPrefix: string; step: SceneStep; onChange(next: SceneStep): void }): React.JSX.Element | null {
  switch (step.kind) {
    case 'say':
      return (
        <>
          <TextField label="Text ($N is the player's name)" long value={step.text} onChange={(text) => onChange({ ...step, text })} />
          <SelectField label="How" value={step.style} options={[['say', 'Say'], ['yell', 'Yell'], ['emote', 'As an emote']] as const} onChange={(style) => onChange({ ...step, style })} />
        </>
      );
    case 'emote':
      return <NumberField label="Emote ID" value={step.emote} onChange={(emote) => onChange({ ...step, emote })} />;
    case 'credit':
      return (
        <>
          <SelectField
            label="Objective"
            value={String(step.objective) as '1' | '2' | '3' | '4'}
            options={[['1', 'Objective 1'], ['2', 'Objective 2'], ['3', 'Objective 3'], ['4', 'Objective 4']] as const}
            onChange={(o) => onChange({ ...step, objective: Number(o) as 1 | 2 | 3 | 4 })}
          />
          <CheckField label="The whole group" value={step.group} onChange={(group) => onChange({ ...step, group })} />
        </>
      );
    case 'eventCredit':
      return <CheckField label="The whole group" value={step.group} onChange={(group) => onChange({ ...step, group })} />;
    case 'castOnPlayer':
    case 'castOnSelf':
      return <NumberField label="Spell ID" value={step.spellId} onChange={(spellId) => onChange({ ...step, spellId })} />;
    case 'giveItem':
    case 'takeItem':
      return (
        <>
          <EntityField id={`${idPrefix}-item`} label="Item" kind="item" value={step.item} onChange={(item) => onChange({ ...step, item })} />
          <NumberField label="How many" value={step.count} min={1} onChange={(count) => onChange({ ...step, count })} />
        </>
      );
    case 'spawnNpc':
      return (
        <>
          <EntityField id={`${idPrefix}-npc`} label="NPC" kind="creature" value={step.entry} onChange={(entry) => onChange({ ...step, entry })} />
          <PositionInput idPrefix={`${idPrefix}-at`} value={step.at} onChange={(at) => onChange({ ...step, at })} />
          <NumberField label="Despawn after (seconds; 0 = when its corpse fades)" value={step.despawnAfterS} min={0} onChange={(despawnAfterS) => onChange({ ...step, despawnAfterS })} />
          <CheckField label="Attacks the player" value={step.attackPlayer} onChange={(attackPlayer) => onChange({ ...step, attackPlayer })} />
        </>
      );
    case 'spawnObject':
      return (
        <>
          <EntityField id={`${idPrefix}-object`} label="Object" kind="gameobject" value={step.entry} onChange={(entry) => onChange({ ...step, entry })} />
          <PositionInput idPrefix={`${idPrefix}-at`} value={step.at} onChange={(at) => onChange({ ...step, at })} />
          <NumberField label="Despawn after (seconds)" value={step.despawnAfterS} min={0} onChange={(despawnAfterS) => onChange({ ...step, despawnAfterS })} />
        </>
      );
    case 'despawn':
      return (
        <>
          <EntityField id={`${idPrefix}-npc`} label="NPC to despawn (empty = itself)" kind="creature" value={step.entry} onChange={(entry) => onChange({ ...step, entry })} />
          {step.entry !== 0 && <NumberField label="Within (yards)" value={step.range} onChange={(range) => onChange({ ...step, range })} />}
        </>
      );
    case 'moveTo':
      return <PositionInput idPrefix={`${idPrefix}-at`} value={step.at} onChange={(at) => onChange({ ...step, at })} />;
    case 'startEscort':
      return (
        <>
          <CheckField label="Run instead of walk" value={step.run} onChange={(run) => onChange({ ...step, run })} />
          <ol className="scene-points">
            {step.points.map((point, i) => (
              <li key={i}>
                <PositionInput
                  idPrefix={`${idPrefix}-p${i}`}
                  value={point}
                  onChange={(next) => onChange({ ...step, points: step.points.map((p, j) => (j === i ? next : p)) })}
                />
                <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange({ ...step, points: step.points.filter((_, j) => j !== i) })}>
                  Remove point {i + 1}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn" onClick={() => onChange({ ...step, points: [...step.points, step.points.at(-1) ?? ORIGIN] })}>
            Add point
          </button>
        </>
      );
    case 'npcFlags':
      return (
        <>
          <SelectField label="Offers quests" value={step.questGiver} options={TOGGLES} onChange={(questGiver) => onChange({ ...step, questGiver })} />
          <SelectField label="Can be talked to" value={step.gossip} options={TOGGLES} onChange={(gossip) => onChange({ ...step, gossip })} />
        </>
      );
    case 'faction':
      return <NumberField label="Faction ID (0 = back to its own)" value={step.faction} onChange={(faction) => onChange({ ...step, faction })} />;
    case 'objectState':
      return (
        <>
          <SelectField label="Make it" value={step.state} options={[['open', 'Open'], ['closed', 'Closed']] as const} onChange={(state) => onChange({ ...step, state })} />
          <EntityField id={`${idPrefix}-object`} label="Object (empty = itself)" kind="gameobject" value={step.entry} onChange={(entry) => onChange({ ...step, entry })} />
          {step.entry !== 0 && <NumberField label="Within (yards)" value={step.range} onChange={(range) => onChange({ ...step, range })} />}
        </>
      );
    case 'signal':
      return (
        <>
          <NumberField label="Signal number" value={step.signal} onChange={(signal) => onChange({ ...step, signal })} />
          <SelectField label="Tell" value={step.targetKind} options={[['creature', 'An NPC'], ['gameobject', 'An object']] as const} onChange={(targetKind) => onChange({ ...step, targetKind, entry: 0 })} />
          <EntityField
            id={`${idPrefix}-target`}
            label={step.targetKind === 'creature' ? 'NPC' : 'Object'}
            kind={step.targetKind}
            value={step.entry}
            onChange={(entry) => onChange({ ...step, entry })}
          />
          <NumberField label="Within (yards)" value={step.range} onChange={(range) => onChange({ ...step, range })} />
        </>
      );
    case 'failQuest':
    case 'closeGossip':
      return null;
  }
}

/** The "Then…" list: steps in order, each with its wait and move/remove buttons. */
export function StepEditor({
  idPrefix,
  owner,
  steps,
  onChange,
}: {
  idPrefix: string;
  owner: OwnerKind;
  steps: readonly SceneStep[];
  onChange(next: SceneStep[]): void;
}): React.JSX.Element {
  const set = (i: number, step: SceneStep): void => onChange(steps.map((s, j) => (j === i ? step : s)));
  const move = (i: number, by: -1 | 1): void => {
    const next = [...steps];
    const [taken] = next.splice(i, 1);
    next.splice(i + by, 0, taken!);
    onChange(next);
  };

  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Then</h4>
      {steps.length === 0 && <p className="scene-hint">Nothing happens yet. Add a step.</p>}
      <ol className="scene-steps">
        {steps.map((step, i) => (
          <li key={i} className="scene-step">
            <div className="scene-step__head">
              <strong>{STEP_LABELS[step.kind]}</strong>
              <span className="entry-card__actions">
                <button type="button" className="entry-card__btn" disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </button>
                <button type="button" className="entry-card__btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                  Down
                </button>
                <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </span>
            </div>
            <NumberField
              label={i === 0 ? 'Wait first (seconds)' : 'Wait after the step before (seconds)'}
              value={step.waitMs / 1000}
              min={0}
              onChange={(seconds) => set(i, { ...step, waitMs: Math.max(0, Math.round(seconds * 1000)) })}
            />
            <StepFields idPrefix={`${idPrefix}-s${i}`} step={step} onChange={(next) => set(i, next)} />
          </li>
        ))}
      </ol>
      <label className="scene-field">
        <span>Add step</span>
        <select
          aria-label="Add step"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...steps, defaultStep(e.target.value as StepKind)]);
          }}
        >
          <option value="">Choose a step to add…</option>
          {stepsFor(owner).map((k) => (
            <option key={k} value={k}>
              {STEP_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
