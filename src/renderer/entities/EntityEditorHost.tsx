import { useEffect } from 'react';
import { ENTITIES_FIELD, readEntities, writeEntities, type CustomNpc, type CustomObject } from '@core/entities/model';
import { readGivers, writeGivers } from '@core/modules/givers';
import type { FieldValue } from '@core/registry/types';
import type { AllocKind } from '@shared/ipc';
import { PanelFrame } from '../modules/ModulePanel';
import { useApi } from '../state/names';
import { NpcEditor } from './npc/NpcEditor';
import { ObjectEditor } from './object/ObjectEditor';
import { stillNeeds } from './still-needs';

type Values = Readonly<Record<string, FieldValue>>;

/** Which entity the editor shows, whether it was just made, and the tab it is on. */
export interface EditorState {
  kind: 'npc' | 'object';
  entry: number;
  isNew: boolean;
  tab?: string;
}


/**
 * The NPC or object editor as a modal: its title, its tabs and a footer with Done and Discard (a
 * new one) or Delete. Edits are written to the quest as they are made; Discard and Delete remove
 * the entity and every giver row that points at it. When the entity goes away (an undo) the editor
 * closes itself.
 */
export function EntityEditorHost({
  values,
  onChange,
  state,
  onTab,
  onClose,
  hasServerData = true,
}: {
  /** Whether the connection names a server data folder, which looks are named from. */
  hasServerData?: boolean;
  values: Values;
  onChange(fieldId: string, value: FieldValue): void;
  state: EditorState;
  onTab(tab: string): void;
  onClose(): void;
}): React.JSX.Element | null {
  const api = useApi();
  const entities = readEntities(values);
  const npc = state.kind === 'npc' ? entities.npcs.find((n) => n.entry === state.entry) : undefined;
  const object = state.kind === 'object' ? entities.objects.find((o) => o.entry === state.entry) : undefined;
  const entity = npc ?? object;

  useEffect(() => {
    if (!entity) onClose();
  }, [entity, onClose]);
  if (!entity) return null;

  const word = state.kind === 'npc' ? 'NPC' : 'object';
  const title = state.isNew ? `New ${word}` : `${state.kind === 'npc' ? 'NPC' : 'Object'}: ${entity.name.trim() || entity.entry}`;

  async function allocate(kind: AllocKind): Promise<number | null> {
    const result = await api?.allocateIds(kind, 1);
    return result?.ok && result.value.length > 0 ? result.value[0]! : null;
  }

  const saveNpc = (next: CustomNpc): void =>
    onChange(ENTITIES_FIELD, writeEntities({ ...entities, npcs: entities.npcs.map((n) => (n.entry === next.entry ? next : n)) }));
  const saveObject = (next: CustomObject): void =>
    onChange(ENTITIES_FIELD, writeEntities({ ...entities, objects: entities.objects.map((o) => (o.entry === next.entry ? next : o)) }));

  function remove(): void {
    const verb = state.isNew ? 'Discard' : 'Delete';
    if (!window.confirm(`${verb} this ${word}? It is removed from the quest.`)) return;
    onChange(
      ENTITIES_FIELD,
      writeEntities(state.kind === 'npc'
        ? { ...entities, npcs: entities.npcs.filter((n) => n.entry !== state.entry) }
        : { ...entities, objects: entities.objects.filter((o) => o.entry !== state.entry) }),
    );
    // A giver card must not be left pointing at something that is gone: it goes back to empty, as it
    // was before New, and one empty card per role is enough.
    const kind = state.kind === 'npc' ? 'creature' : 'gameobject';
    for (const role of ['start', 'end'] as const) {
      const targets = readGivers(values, role);
      if (!targets.some((t) => t.kind === kind && t.id === state.entry)) continue;
      const emptied = targets.map((t) => (t.kind === kind && t.id === state.entry ? { ...t, id: 0 } : t));
      const kept = emptied.filter((t, i) => t.id !== 0 || emptied.findIndex((u) => u.id === 0) === i);
      for (const [fieldId, value] of Object.entries(writeGivers(role, kept))) {
        if (JSON.stringify(value) !== JSON.stringify(values[fieldId] ?? [])) onChange(fieldId, value);
      }
    }
    onClose();
  }

  const needs = stillNeeds(entity);
  const footer = (
    <>
      <span className="scene-hint">{needs && `Still needs ${needs}.`}</span>
      <span className="entry-card__actions">
        <button type="button" className="btn entry-card__btn--danger" onClick={remove}>
          {state.isNew ? 'Discard' : `Delete ${word}`}
        </button>
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </span>
    </>
  );

  return (
    <PanelFrame title={title} onClose={onClose} footer={footer}>
      {npc && (
        <NpcEditor npc={npc} onChange={saveNpc} allocateSpawn={() => allocate('creatureSpawn')} tab={state.tab} onTab={onTab}
          others={entities.npcs.filter((n) => n.entry !== npc.entry)} hasServerData={hasServerData} />
      )}
      {object && (
        <ObjectEditor object={object} onChange={saveObject} allocateSpawn={() => allocate('gameobjectSpawn')} allocatePage={() => allocate('page')}
          tab={state.tab} onTab={onTab} hasServerData={hasServerData} />
      )}
    </PanelFrame>
  );
}
