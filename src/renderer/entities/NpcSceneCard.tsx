import { useState } from 'react';
import type { CustomNpc } from '@core/entities/model';
import { describeTrigger } from '@core/scripts/describe';
import { NPC_TRIGGER_KINDS, needsQuest, type NpcScene } from '@core/scripts/npc-scenes';
import { NumberField, SelectField, TextField } from '../scripts/fields';
import { GateEditor } from '../scripts/GateEditor';
import { StepEditor } from '../scripts/StepEditor';
import { TriggerEditor } from '../scripts/TriggerEditor';
import { menuLabel } from './GossipMenuEditor';

const OTHER = 'other';
const NO_OPTION = '';

/** The options of the NPC's own menu a scene can wait for: not in a locked menu, not kept */
function Picker({
  npc, scene, onChange, onTab,
}: { npc: CustomNpc; scene: NpcScene; onChange(next: NpcScene): void; onTab?(id: string): void }): React.JSX.Element {
  const trigger = scene.trigger;
  if (trigger.kind !== 'gossipPicked') return <></>;
  const tree = npc.gossipMenu;
  if (!tree) {
    return (
      <p className="scene-hint">
        This NPC has no talk window yet.{' '}
        <button type="button" className="btn" onClick={() => onTab?.('gossip')}>
          Give this NPC a gossip menu
        </button>
      </p>
    );
  }
  const pickable = tree.menus.flatMap((m, i) =>
    m.locked ? [] : m.options.filter((o) => !o.kept).map((o) => [`${m.menuId}:${o.optionId}`, `${menuLabel(m, i)} → ${o.text.trim() || `Option ${o.optionId + 1}`}`] as const),
  );
  const current = `${trigger.menuId}:${trigger.optionId}`;
  const stale = !pickable.some(([key]) => key === current);
  return (
    <SelectField
      label="Menu and option"
      value={stale && trigger.menuId === 0 ? NO_OPTION : current}
      options={[
        [NO_OPTION, 'Choose an option…'],
        ...(stale && trigger.menuId !== 0 ? ([[current, `Option ${trigger.optionId} of menu ${trigger.menuId} (not available)`]] as const) : []),
        ...pickable,
      ]}
      onChange={(key) => {
        if (key === NO_OPTION) return;
        const [menuId, optionId] = key.split(':').map(Number) as [number, number];
        onChange({ ...scene, trigger: { kind: 'gossipPicked', menuId, optionId } });
      }}
    />
  );
}

/** Which quest a scene is about: none, one of the project's, or any id */
function QuestField({ scene, quests, onChange }: { scene: NpcScene; quests: readonly { questId: number; title: string }[]; onChange(next: NpcScene): void }): React.JSX.Element {
  const known = scene.questId === 0 || quests.some((q) => q.questId === scene.questId);
  const [custom, setCustom] = useState(!known);
  // A quest that is no longer in the project is shown as an id to type, not as an option that is gone
  const value = custom || !known ? OTHER : String(scene.questId);
  return (
    <>
      <SelectField
        label="Quest"
        value={value}
        options={[
          ['0', 'None'],
          ...quests.map((q) => [String(q.questId), q.title.trim() || `Quest ${q.questId}`] as const),
          [OTHER, 'Other…'],
        ]}
        onChange={(next) => {
          setCustom(next === OTHER);
          if (next !== OTHER) onChange({ ...scene, questId: Number(next) });
        }}
      />
      {(custom || !known) && <NumberField label="Quest ID" value={scene.questId} min={0} onChange={(questId) => onChange({ ...scene, questId: Math.max(0, Math.round(questId)) })} />}
    </>
  );
}

/** One scene of an NPC: its name, quest, trigger, conditions and steps, all edited in place */
export function NpcSceneCard({
  npc, scene, scenes, quests, readOnly, onChange, onRemove, onDuplicate, onTab,
}: {
  npc: CustomNpc;
  scene: NpcScene;
  scenes: readonly NpcScene[];
  quests: readonly { questId: number; title: string }[];
  readOnly: boolean;
  onChange(next: NpcScene): void;
  onRemove(): void;
  onDuplicate(): void;
  onTab?(id: string): void;
}): React.JSX.Element {
  const title = scene.name.trim() || describeTrigger(scene.trigger);
  const idPrefix = `npc-${npc.entry}-${scene.id}`;
  return (
    <fieldset className="entry-card scene-card" aria-label={`Scene: ${title}`} disabled={readOnly}>
      <div className="entry-card__head">
        <h3 className="entry-card__title">{title}</h3>
        <span className="entry-card__actions">
          <button type="button" className="entry-card__btn" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={onRemove}>
            Remove scene
          </button>
        </span>
      </div>
      <TextField label="Name (for you)" value={scene.name} onChange={(name) => onChange({ ...scene, name })} />
      <div className="scene-section">
        <QuestField scene={scene} quests={quests} onChange={onChange} />
        {needsQuest(scene) && scene.questId === 0 && <p className="scene-hint">needs a quest</p>}
      </div>
      <TriggerEditor
        scene={{ trigger: scene.trigger, owner: { kind: 'creature' } }}
        scenes={scenes}
        kinds={NPC_TRIGGER_KINDS}
        onChange={(trigger) => onChange({ ...scene, trigger })}
        renderPicked={() => <Picker npc={npc} scene={scene} onChange={onChange} onTab={onTab} />}
      />
      <GateEditor idPrefix={idPrefix} gates={scene.gates} onChange={(gates) => onChange({ ...scene, gates })} />
      <StepEditor idPrefix={idPrefix} sceneId={`npc${npc.entry}${scene.id}`} owner="creature" steps={scene.steps} onChange={(steps) => onChange({ ...scene, steps })} />
    </fieldset>
  );
}
