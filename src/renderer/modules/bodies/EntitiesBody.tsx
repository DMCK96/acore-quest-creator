import { useState } from 'react';
import type { CustomItem, CustomNpc, CustomObject } from '@core/entities/model';
import { narrowTo, questUses } from '@core/entities/links';
import { classLabel } from '@core/entities/item-vocab';
import { QUALITIES } from '../../entities/item/ItemBasics';
import { useEntityEditor, type EditorRequest } from '../../entities/EntityEditorContext';
import { OBJECT_TYPES } from '../../entities/object/ObjectBasics';
import { stillNeeds } from '../../entities/still-needs';
import { otherUsers, useProjectEntities } from '../../state/project-entities';
import type { ModuleBodyProps } from '../body-props';
import { AddFromProject } from './AddFromProject';
import '../../scripts/scripts.css';
import '../../entities/editor.css';

const placed = (spawns: readonly unknown[]): string => (spawns.length > 0 ? 'placed' : 'not placed');
const needs = (entity: { name: string; displayId: number }): string => {
  const missing = stillNeeds(entity);
  return missing ? ` · still needs ${missing}` : '';
};
const levels = (npc: CustomNpc): string => (npc.minLevel === npc.maxLevel ? `Level ${npc.minLevel}` : `Level ${npc.minLevel}–${npc.maxLevel}`);
const typeLabel = (object: CustomObject): string => OBJECT_TYPES.find(([t]) => t === object.type)?.[1] ?? object.type;
const itemFacts = (item: CustomItem): string => {
  const quality = QUALITIES.find(([q]) => q === item.quality)?.[1] ?? item.quality;
  return `${quality} · ${classLabel(item.itemClass)}${item.name.trim() ? '' : ' · still needs a name'}`;
};

/**
 * The project's NPCs, objects and items this quest uses (made for it, or named by it) as a list, each
 * with the other quests that use it; making or changing one happens in its editor, and any other in
 * the project can be added to the quest in a part it plays.
 */
export function EntitiesBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const project = useProjectEntities();
  const store = project?.entities ?? { npcs: [], objects: [], items: [] };
  const quests = project?.quests ?? [];
  const use = questUses({ questId: open.questId, aggregate: open.aggregate }, store);
  const entities = narrowTo(store, use);
  const openEditor = useEntityEditor();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function request(req: EditorRequest): Promise<void> {
    if (!openEditor) return;
    setError(await openEditor(req));
  }

  const also = (kind: 'npcs' | 'objects' | 'items', entry: number): string => {
    const titles = otherUsers(quests, open.questId, kind, entry);
    return titles.length > 0 ? `Also used by ${titles.join(', ')}` : '';
  };
  const row = (key: string, name: string, facts: string, shared: string, req: EditorRequest): React.JSX.Element => (
    <li key={key} aria-label={name} className="entity-row">
      <span className="entity-row__name">{name}</span>
      <span className="scene-hint">{facts}</span>
      {shared && <span className="scene-hint">{shared}</span>}
      <button type="button" className="entry-card__btn" onClick={() => void request(req)}>
        Edit
      </button>
    </li>
  );

  return (
    <div className="scripts-body">
      <p className="scene-hint">
        These are the project&apos;s new NPCs, objects and items this quest uses. They are written with the project patch. Removing one here
        does not remove rows an earlier export or apply already put in the database.
      </p>
      {error && <p className="scene-warning">{error}</p>}
      <div className="scripts-body__add">
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newNpc', madeFor: open.questId })}>
          Add NPC
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newObject', madeFor: open.questId })}>
          Add object
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void request({ kind: 'newItem', madeFor: open.questId })}>
          Add item
        </button>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          Add from project…
        </button>
      </div>
      <ul aria-label="NPCs, objects and items" className="entity-list">
        {entities.npcs.map((npc) =>
          row(`n${npc.entry}`, npc.name.trim() || `New NPC ${npc.entry}`, `${levels(npc)} · ${placed(npc.spawns)}${needs(npc)}`, also('npcs', npc.entry), { kind: 'npc', entry: npc.entry }))}
        {entities.objects.map((object) =>
          row(`o${object.entry}`, object.name.trim() || `New object ${object.entry}`, `${typeLabel(object)} · ${placed(object.spawns)}${needs(object)}`, also('objects', object.entry), { kind: 'object', entry: object.entry }))}
        {entities.items.map((item) =>
          row(`i${item.entry}`, item.name.trim() || `New item ${item.entry}`, itemFacts(item), also('items', item.entry), { kind: 'item', entry: item.entry }))}
      </ul>
      {adding && <AddFromProject store={store} use={use} values={open.aggregate.values} onChange={onChange} onClose={() => setAdding(false)} />}
    </div>
  );
}
