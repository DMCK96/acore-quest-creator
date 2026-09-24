import { useState } from 'react';
import { readEntities, type CustomNpc, type CustomObject } from '@core/entities/model';
import { useEntityEditor, type EditorRequest } from '../../entities/EntityEditorContext';
import { OBJECT_TYPES } from '../../entities/object/ObjectBasics';
import type { ModuleBodyProps } from '../body-props';
import '../../scripts/scripts.css';
import '../../entities/editor.css';

const placed = (spawns: readonly unknown[]): string => (spawns.length > 0 ? 'placed' : 'not placed');
const levels = (npc: CustomNpc): string => (npc.minLevel === npc.maxLevel ? `Level ${npc.minLevel}` : `Level ${npc.minLevel}–${npc.maxLevel}`);
const typeLabel = (object: CustomObject): string => OBJECT_TYPES.find(([t]) => t === object.type)?.[1] ?? object.type;

/** The quest's new NPCs and objects as a list; making or changing one happens in its editor. */
export function EntitiesBody({ open }: ModuleBodyProps): React.JSX.Element {
  const entities = readEntities(open.aggregate.values);
  const openEditor = useEntityEditor();
  const [error, setError] = useState<string | null>(null);

  async function request(req: EditorRequest): Promise<void> {
    if (!openEditor) return;
    setError(await openEditor(req));
  }

  const row = (key: string, name: string, facts: string, req: EditorRequest): React.JSX.Element => (
    <li key={key} aria-label={name} className="entity-row">
      <span className="entity-row__name">{name}</span>
      <span className="scene-hint">{facts}</span>
      <button type="button" className="entry-card__btn" onClick={() => void request(req)}>
        Edit
      </button>
    </li>
  );

  return (
    <div className="scripts-body">
      <p className="scene-hint">
        These are new NPCs and objects, written with this quest. Removing one here does not remove rows an earlier export or apply
        already put in the database.
      </p>
      {error && <p className="scene-warning">{error}</p>}
      <div className="scripts-body__add">
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newNpc' })}>
          Add NPC
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newObject' })}>
          Add object
        </button>
      </div>
      <ul aria-label="NPCs and objects" className="entity-list">
        {entities.npcs.map((npc) =>
          row(`n${npc.entry}`, npc.name.trim() || `New NPC ${npc.entry}`, `${levels(npc)} · ${placed(npc.spawns)}`, { kind: 'npc', entry: npc.entry }))}
        {entities.objects.map((object) =>
          row(`o${object.entry}`, object.name.trim() || `New object ${object.entry}`, `${typeLabel(object)} · ${placed(object.spawns)}`, { kind: 'object', entry: object.entry }))}
      </ul>
    </div>
  );
}
