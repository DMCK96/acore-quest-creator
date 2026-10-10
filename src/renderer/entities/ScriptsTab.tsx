import type { CustomNpc } from '@core/entities/model';
import { NPC_SCENE_LIMIT, blankNpcScene, nextNpcSceneId, type NpcScene } from '@core/scripts/npc-scenes';
import { NpcSceneCard } from './NpcSceneCard';

/** The Scripts tab's body: the scenes the NPC owns, whatever the quest */
export function ScriptsTab({
  npc, onChange, onTab, quests = [],
}: {
  npc: CustomNpc;
  onChange(next: CustomNpc): void;
  onTab?(id: string): void;
  /** The project's quests a scene can be about */
  quests?: readonly { questId: number; title: string }[];
}): React.JSX.Element {
  const scenes = npc.scenes;
  const locked = npc.origin.kind === 'existing' && npc.origin.locked.includes('scenes');
  const databaseScripts = npc.origin.kind === 'existing' ? (npc.origin.databaseScripts ?? 0) : 0;
  const setScenes = (next: NpcScene[]): void => onChange({ ...npc, scenes: next });
  const full = scenes.length >= NPC_SCENE_LIMIT;

  return (
    <>
      {locked && <p className="scene-hint">This NPC runs another AI or a script, so scenes are not written for it.</p>}
      {databaseScripts > 0 && (
        <p className="scene-hint">
          The database already runs {databaseScripts} {databaseScripts === 1 ? 'script' : 'scripts'} on this NPC; they are not edited here.
        </p>
      )}
      {scenes.length === 0 && <p className="scene-hint">This NPC has no scenes. A scene says what it does when something happens to it.</p>}
      {scenes.map((scene, i) => (
        <NpcSceneCard
          key={scene.id}
          npc={npc}
          scene={scene}
          scenes={scenes}
          quests={quests}
          readOnly={locked}
          onTab={onTab}
          onChange={(next) => setScenes(scenes.map((s, j) => (j === i ? next : s)))}
          onRemove={() => setScenes(scenes.filter((_, j) => j !== i))}
          onDuplicate={() => {
            if (full) return;
            const copy: NpcScene = { ...structuredClone(scene), id: nextNpcSceneId(scenes), name: `${scene.name.trim() || 'Scene'} (copy)` };
            setScenes([...scenes.slice(0, i + 1), copy, ...scenes.slice(i + 1)]);
          }}
        />
      ))}
      <button type="button" className="btn" disabled={locked || full} onClick={() => setScenes([...scenes, blankNpcScene(nextNpcSceneId(scenes))])}>
        Add scene
      </button>
      {full && <p className="scene-hint">An NPC can have {NPC_SCENE_LIMIT} scenes.</p>}
    </>
  );
}
