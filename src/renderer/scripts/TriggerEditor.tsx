import { describeTrigger } from '@core/scripts/describe';
import { triggerOwners, type OwnerKind, type SceneStep, type SceneTrigger, type TriggerKind } from '@core/scripts/model';
import type { NpcTrigger, NpcTriggerKind } from '@core/scripts/npc-scenes';
import { NumberField, SelectField, TextField } from './fields';

/** What each trigger is called in the "When" list, before its parameters are filled in. */
export const TRIGGER_LABELS: Record<NpcTriggerKind, string> = {
  questAccepted: 'The quest is accepted',
  questHandedIn: 'The quest is handed in',
  spellHit: 'A spell or item is used on it',
  dies: 'It dies',
  talkedTo: 'A player talks to it or uses it',
  gossipOption: 'A player picks a talk option',
  gossipPicked: 'A player picks an option of its talk window',
  playerNear: 'A player comes near',
  enterArea: 'A player enters the area',
  signal: 'Another script tells it',
  waypointReached: 'The escort reaches a point',
  summoned: 'It is spawned by a scene',
};

// An option of the NPC's own menu is a trigger of its own scenes only; no owner kind carries it
const TRIGGER_ORDER = (Object.keys(TRIGGER_LABELS) as NpcTriggerKind[]).filter((k): k is TriggerKind => k !== 'gossipPicked');

/** The triggers an owner of this kind can have, in list order. */
export function triggersFor(kind: OwnerKind): TriggerKind[] {
  return TRIGGER_ORDER.filter((t) => triggerOwners(t).includes(kind));
}

/** A trigger of this kind with its parameters at their starting values. */
export function defaultTrigger(kind: NpcTriggerKind, scenes: readonly SceneLike[]): NpcTrigger {
  switch (kind) {
    case 'gossipPicked':
      return { kind, menuId: 0, optionId: 0 };
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

/** What the trigger editor needs to know of the scenes around it: their ids, names and escorts */
export interface SceneLike {
  id: string;
  name: string;
  trigger: NpcTrigger;
  steps: readonly SceneStep[];
}

export function TriggerEditor({
  scene,
  scenes,
  onChange,
  kinds: allowed,
  renderPicked,
}: {
  scene: { trigger: NpcTrigger; owner: { kind: OwnerKind } };
  scenes: readonly SceneLike[];
  onChange(next: NpcTrigger): void;
  /** The triggers to offer; by default those the scene's owner can carry */
  kinds?: readonly NpcTriggerKind[];
  /** The picker for a `gossipPicked` trigger, which only an NPC's own scenes have */
  renderPicked?(trigger: Extract<NpcTrigger, { kind: 'gossipPicked' }>, set: (next: NpcTrigger) => void): React.ReactNode;
}): React.JSX.Element {
  const trigger = scene.trigger;
  const kinds: readonly NpcTriggerKind[] = allowed ?? triggersFor(scene.owner.kind);
  const escorts = scenes.filter((s) => s.steps.some((step) => step.kind === 'startEscort'));

  return (
    <div className="scene-section">
      <label className="scene-field">
        <span>When</span>
        <select aria-label="When" value={trigger.kind} onChange={(e) => onChange(defaultTrigger(e.target.value as NpcTriggerKind, scenes))}>
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
      {trigger.kind === 'gossipPicked' && renderPicked?.(trigger, onChange)}
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
