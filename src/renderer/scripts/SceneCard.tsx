import { describeTrigger } from '@core/scripts/describe';
import { triggerOwners, type OwnerKind, type QuestScene, type SceneOwner } from '@core/scripts/model';
import { CheckField, EntityField, NumberField, SelectField, TextField } from './fields';
import { GateEditor } from './GateEditor';
import { PositionInput } from './PositionInput';
import { StepEditor } from './StepEditor';
import { TriggerEditor, defaultTrigger, triggersFor } from './TriggerEditor';

const OWNER_KINDS = [
  ['creature', 'An NPC'],
  ['gameobject', 'An object'],
  ['areatrigger', 'An area'],
] as const;

function emptyOwner(kind: OwnerKind): SceneOwner {
  return kind === 'areatrigger' ? { kind, id: 0 } : { kind, entry: 0 };
}

/** Who the scene runs on: an NPC or object by name, or an area, existing or created here. */
function OwnerEditor({ idPrefix, owner, markerId, onChange }: { idPrefix: string; owner: SceneOwner; markerId: string; onChange(next: SceneOwner): void }): React.JSX.Element {
  return (
    <div className="scene-section">
      <SelectField label="Runs on" value={owner.kind} options={OWNER_KINDS} onChange={(kind) => onChange(emptyOwner(kind))} />
      {owner.kind === 'creature' && (
        <EntityField id={`${idPrefix}-owner`} label="NPC" kind="creature" value={owner.entry} onChange={(entry) => onChange({ ...owner, entry })} />
      )}
      {owner.kind === 'gameobject' && (
        <EntityField id={`${idPrefix}-owner`} label="Object" kind="gameobject" value={owner.entry} onChange={(entry) => onChange({ ...owner, entry })} />
      )}
      {owner.kind === 'areatrigger' && (
        <>
          <CheckField
            label="Create a new area here"
            value={owner.area !== undefined}
            onChange={(create) =>
              onChange(create ? { kind: 'areatrigger', id: 0, area: { map: 0, x: 0, y: 0, z: 0, radius: 5 } } : { kind: 'areatrigger', id: 0 })
            }
          />
          {owner.area ? (
            <>
              <NumberField label="Map" value={owner.area.map} onChange={(map) => onChange({ ...owner, area: { ...owner.area!, map } })} />
              <PositionInput
                idPrefix={`${idPrefix}-area`}
                value={{ x: owner.area.x, y: owner.area.y, z: owner.area.z, o: 0 }}
                map={owner.area.map}
                markerId={markerId}
                onChange={(p, map) => onChange({ ...owner, area: { ...owner.area!, x: p.x, y: p.y, z: p.z, map: map ?? owner.area!.map } })}
              />
              <NumberField label="Radius (yards)" value={owner.area.radius} min={1} onChange={(radius) => onChange({ ...owner, area: { ...owner.area!, radius } })} />
            </>
          ) : (
            <NumberField label="Area trigger ID" value={owner.id} onChange={(id) => onChange({ ...owner, id })} />
          )}
        </>
      )}
    </div>
  );
}

/** One scene: its name, owner, trigger, conditions and steps, all edited in place. */
export function SceneCard({
  scene,
  scenes,
  onChange,
  onRemove,
}: {
  scene: QuestScene;
  scenes: readonly QuestScene[];
  onChange(next: QuestScene): void;
  onRemove(): void;
}): React.JSX.Element {
  const title = scene.name.trim() || describeTrigger(scene.trigger);
  const idPrefix = `scene-${scene.id}`;

  const setOwner = (owner: SceneOwner): void => {
    // A trigger the new owner cannot have falls back to the first one it can.
    const trigger = triggerOwners(scene.trigger.kind).includes(owner.kind)
      ? scene.trigger
      : defaultTrigger(triggersFor(owner.kind)[0]!, scenes);
    onChange({ ...scene, owner, trigger });
  };

  return (
    <fieldset className="entry-card scene-card" aria-label={`Scene: ${title}`}>
      <div className="entry-card__head">
        <h3 className="entry-card__title">{title}</h3>
        <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={onRemove}>
          Remove scene
        </button>
      </div>
      <TextField label="Name (for you)" value={scene.name} onChange={(name) => onChange({ ...scene, name })} />
      <OwnerEditor idPrefix={idPrefix} owner={scene.owner} markerId={`area:${scene.id}`} onChange={setOwner} />
      <TriggerEditor scene={scene} scenes={scenes} onChange={(trigger) => onChange({ ...scene, trigger })} />
      <GateEditor idPrefix={idPrefix} gates={scene.gates} onChange={(gates) => onChange({ ...scene, gates })} />
      <StepEditor idPrefix={idPrefix} sceneId={scene.id} owner={scene.owner.kind} steps={scene.steps} onChange={(steps) => onChange({ ...scene, steps })} />
    </fieldset>
  );
}
