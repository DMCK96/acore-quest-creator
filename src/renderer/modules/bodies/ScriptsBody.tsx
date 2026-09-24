import { useEffect, useState } from 'react';
import type { FieldValue } from '@core/registry/types';
import { PRESETS, presetScene, type PresetId, type QuestFacts } from '@core/scripts/presets';
import { SCRIPTS_FIELD, nextSceneId, readScenes, writeScenes, type QuestScene, type SceneOwner } from '@core/scripts/model';
import type { QuestScriptsInfo } from '@shared/ipc';
import { useApi, useNameBook } from '../../state/names';
import { SceneCard } from '../../scripts/SceneCard';
import type { ModuleBodyProps } from '../body-props';
import '../../scripts/scripts.css';

const FLAGS_FIELD = 'quest_template_addon.SpecialFlags';
/** `QUEST_SPECIAL_FLAGS_EXPLORATION_OR_EVENT`: lets a script complete the quest. */
const EVENT_FLAG = 2;

const firstOwner = (values: Record<string, FieldValue>, kind: 'starter' | 'ender'): SceneOwner | null => {
  for (const [fieldId, ownerKind] of [
    [`creature_quest${kind}`, 'creature'],
    [`gameobject_quest${kind}`, 'gameobject'],
  ] as const) {
    const rows = values[fieldId];
    if (!Array.isArray(rows)) continue;
    const id = (rows as Array<Record<string, unknown>>).find((r) => typeof r.id === 'number' && r.id > 0)?.id;
    if (typeof id === 'number') return { kind: ownerKind, entry: id };
  }
  return null;
};

function questFacts(questId: number, values: Record<string, FieldValue>): QuestFacts {
  const objectives = values['quest_template.RequiredNpcOrGo'];
  const first = Array.isArray(objectives)
    ? (objectives as Array<{ target?: { target?: string; id?: number } }>).find((o) => o.target?.target === 'creature' && (o.target.id ?? 0) > 0)
    : undefined;
  return { questId, starter: firstOwner(values, 'starter'), ender: firstOwner(values, 'ender'), firstNpcObjective: first?.target?.id ?? 0 };
}

const needsEventFlag = (scenes: readonly QuestScene[]): boolean =>
  scenes.some((s) => s.steps.some((step) => step.kind === 'eventCredit' || step.kind === 'startEscort'));

const OWNER_WORD = { creature: 'NPC', gameobject: 'Object', areatrigger: 'Area' } as const;

/** Scenes the author builds for the quest, then the scripts already on its NPCs and objects. */
export function ScriptsBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const { aggregate } = open;
  const scenes = readScenes(aggregate.values);
  const [preset, setPreset] = useState<PresetId>('blank');
  const api = useApi();
  const names = useNameBook();
  const [info, setInfo] = useState<QuestScriptsInfo | null>(null);

  useEffect(() => {
    let live = true;
    void api?.questScripts(aggregate.questId).then((result) => {
      if (live && result.ok) setInfo(result.value);
    });
    return () => {
      live = false;
    };
  }, [api, aggregate.questId]);

  const save = (next: QuestScene[]): void => {
    onChange(SCRIPTS_FIELD, writeScenes(next));
    // A script can only complete the quest when the quest says it may; switch that on as it is needed.
    const flags = aggregate.values[FLAGS_FIELD];
    if (needsEventFlag(next) && typeof flags === 'number' && (flags & EVENT_FLAG) === 0) onChange(FLAGS_FIELD, flags | EVENT_FLAG);
  };

  const add = (): void => save([...scenes, presetScene(preset, questFacts(aggregate.questId, aggregate.values), nextSceneId(scenes))]);

  return (
    <div className="scripts-body">
      <div className="scripts-body__add">
        <label className="scene-field">
          <span>Start from</span>
          <select aria-label="Start from" value={preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <p className="scene-hint">{PRESETS.find((p) => p.id === preset)?.help}</p>
        <button type="button" className="btn btn--primary" onClick={add}>
          Add scene
        </button>
      </div>

      {scenes.map((scene, i) => (
        <SceneCard
          key={scene.id}
          scene={scene}
          scenes={scenes}
          onChange={(next) => save(scenes.map((s, j) => (j === i ? next : s)))}
          onRemove={() => save(scenes.filter((_, j) => j !== i))}
        />
      ))}

      <h3 className="module-section__title">Other scripts on this quest's NPCs and objects</h3>
      {info && info.unreadable.length > 0 && (
        <p className="scene-warning">
          Scenes {info.unreadable.join(', ')} were written by this tool but their stored data is damaged, so they are left as they are.
        </p>
      )}
      {info && info.missingTables.length > 0 && (
        <p className="scene-warning">The connected database has no {info.missingTables.join(', ')} table.</p>
      )}
      {info === null ? (
        <p className="scene-hint">Looking…</p>
      ) : info.foreign.length === 0 ? (
        <p className="scene-hint">None found.</p>
      ) : (
        <ul className="scripts-body__foreign">
          {info.foreign.map((f, i) => {
            const name = f.ownerKind === 'areatrigger' ? undefined : names(f.ownerKind, f.entry);
            return (
              <li key={i}>
                {name ?? `${OWNER_WORD[f.ownerKind]} ${f.entry}`}: {f.trigger}: {f.steps.join(', ')}
                {f.combat ? ' (combat)' : ''}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
