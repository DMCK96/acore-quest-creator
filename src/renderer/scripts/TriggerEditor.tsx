import { describeTrigger } from '@core/scripts/describe';
import { triggerOwners, type OwnerKind, type QuestScene, type SceneTrigger, type TriggerKind } from '@core/scripts/model';
import { NumberField, SelectField, TextField } from './fields';

/** What each trigger is called in the "When" list, before its parameters are filled in. */
export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  questAccepted: 'The quest is accepted',
  questHandedIn: 'The quest is handed in',
  spellHit: 'A spell or item is used on it',
  dies: 'It dies',
  talkedTo: 'A player talks to it or uses it',
  gossipOption: 'A player picks a talk option',
  playerNear: 'A player comes near',
  enterArea: 'A player enters the area',
  signal: 'Another script tells it',
  waypointReached: 'The escort reaches a point',
  summoned: 'It is spawned by a scene',
};

const TRIGGER_ORDER = Object.keys(TRIGGER_LABELS) as TriggerKind[];

/** The triggers an owner of this kind can have, in list order. */
export function triggersFor(kind: OwnerKind): TriggerKind[] {
  return TRIGGER_ORDER.filter((t) => triggerOwners(t).includes(kind));
}

/** A trigger of this kind with its parameters at their starting values. */
export function defaultTrigger(kind: TriggerKind, scenes: readonly QuestScene[]): SceneTrigger {
  switch (kind) {
    case 'spellHit':
      return { kind, spellId: 0 };
    case 'gossipOption':
      return { kind, text: "I'm ready.", greeting: '' };
    case 'playerNear':
      return { kind, range: 10 };
    case 'signal':
      return { kind, signal: 1 };
    case 'waypointReached': {
      const escort = scenes.find((s) => s.steps.some((step) => step.kind === 'startEscort'));
      return { kind, escortSceneId: escort?.id ?? '', point: 1 };
    }
    default:
      return { kind } as SceneTrigger;
  }
}

export function TriggerEditor({
  scene,
  scenes,
  onChange,
}: {
  scene: QuestScene;
  scenes: readonly QuestScene[];
  onChange(next: SceneTrigger): void;
}): React.JSX.Element {
  const trigger = scene.trigger;
  const kinds = triggersFor(scene.owner.kind);
  const escorts = scenes.filter((s) => s.steps.some((step) => step.kind === 'startEscort'));

  return (
    <div className="scene-section">
      <label className="scene-field">
        <span>When</span>
        <select aria-label="When" value={trigger.kind} onChange={(e) => onChange(defaultTrigger(e.target.value as TriggerKind, scenes))}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {TRIGGER_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {trigger.kind === 'spellHit' && (
        <NumberField label="Spell ID (0 = any spell or item)" value={trigger.spellId} onChange={(spellId) => onChange({ ...trigger, spellId })} />
      )}
      {trigger.kind === 'gossipOption' && (
        <>
          <TextField label="Option text" value={trigger.text} onChange={(text) => onChange({ ...trigger, text })} />
          <TextField
            label="Greeting, if the NPC has no talk window yet"
            value={trigger.greeting}
            onChange={(greeting) => onChange({ ...trigger, greeting })}
          />
        </>
      )}
      {trigger.kind === 'playerNear' && (
        <NumberField label="Range (yards)" value={trigger.range} min={1} onChange={(range) => onChange({ ...trigger, range })} />
      )}
      {trigger.kind === 'signal' && <NumberField label="Signal number" value={trigger.signal} onChange={(signal) => onChange({ ...trigger, signal })} />}
      {trigger.kind === 'waypointReached' && (
        <>
          <SelectField
            label="Escort"
            value={trigger.escortSceneId}
            options={[['', 'Choose the escort scene'] as const, ...escorts.map((s) => [s.id, s.name || describeTrigger(s.trigger)] as const)]}
            onChange={(escortSceneId) => onChange({ ...trigger, escortSceneId })}
          />
          <NumberField label="Point number" value={trigger.point} min={1} onChange={(point) => onChange({ ...trigger, point })} />
        </>
      )}
    </div>
  );
}
