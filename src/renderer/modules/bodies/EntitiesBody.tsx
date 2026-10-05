import { useState } from 'react';
import { questUses } from '@core/entities/links';
import { EntityList } from '../../entities/EntityList';
import { useEntityEditor, type EditorRequest } from '../../entities/EntityEditorContext';
import { useProjectEntities } from '../../state/project-entities';
import type { ModuleBodyProps } from '../body-props';
import { AddFromProject } from './AddFromProject';
import '../../scripts/scripts.css';
import '../../entities/editor.css';

/**
 * The project's NPCs, objects and items: everything new and every existing one it changed, this quest's first,
 * each with the other quests that use it. New ones are edited in their editor; any other in the project can
 * be added to the quest in a part it plays.
 */
export function EntitiesBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const project = useProjectEntities();
  const store = project?.entities ?? { npcs: [], objects: [], items: [] };
  const quests = project?.quests ?? [];
  const use = questUses({ questId: open.questId, aggregate: open.aggregate }, store);
  const openEditor = useEntityEditor();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function request(req: EditorRequest): Promise<void> {
    if (!openEditor) return;
    setError(await openEditor(req));
  }

  return (
    <div className="scripts-body">
      <p className="scene-hint">
        These are the project&apos;s NPCs, objects and items: everything new, and every existing one the project changed. This quest&apos;s
        come first. They are written with the project patch.
      </p>
      {error && <p className="scene-warning">{error}</p>}
      <div className="scripts-body__add">
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newNpc' })}>
          Add NPC
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newObject' })}>
          Add object
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newItem' })}>
          Add item
        </button>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          Add from project…
        </button>
      </div>
      <EntityList tracked={project?.tracked ?? []} quests={quests} openQuestId={open.questId} canEdit={(e) => e.origin === 'new'} onEdit={(ref) => void request(ref)} />
      {adding && <AddFromProject store={store} use={use} values={open.aggregate.values} onChange={onChange} onClose={() => setAdding(false)} />}
    </div>
  );
}
