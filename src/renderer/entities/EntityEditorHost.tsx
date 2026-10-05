import { useEffect, useState } from 'react';
import type { CustomItem, CustomNpc, CustomObject, ProjectEntities } from '@core/entities/model';
import type { ColumnInfo } from '@core/db/types';
import type { ProjectQuestUse } from '../state/project-entities';
import type { AllocKind } from '@shared/ipc';
import { PanelFrame } from '../modules/ModulePanel';
import { useApi } from '../state/names';
import { ItemEditor } from './item/ItemEditor';
import { NpcEditor } from './npc/NpcEditor';
import type { ExistingFacts } from './existing-facts';
import { ObjectEditor } from './object/ObjectEditor';
import { stillNeeds } from './still-needs';

/** Which entity the editor shows, whether it was just made, and the tab it is on. */
export interface EditorState {
  kind: 'npc' | 'object' | 'item';
  entry: number;
  isNew: boolean;
  tab?: string;
}


/** "'A'", "'A' and 'B'", "'A', 'B' and 'C'" */
function quoted(titles: readonly string[]): string {
  const q = titles.map((t) => `'${t}'`);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} and ${q.at(-1)}`;
}

/**
 * The NPC, object or item editor as a modal: its title, its tabs and a footer with Done and Discard (a
 * new one) or Delete. Edits are written to the project's store as they are made. Delete asks first,
 * naming the quests that use it, then hands the delete to `onDelete` (which also empties those
 * quests' giver cards, as one step); without one it only takes the entity out of the store. An existing
 * entity (one the database already has) is titled so, and puts it back as the database has it instead of
 * deleting it: it only leaves the store, as the quests naming it still name it. When the entity goes away
 * (an undo) the editor closes itself.
 */
export function EntityEditorHost({
  entities,
  onChange,
  quests,
  state,
  onTab,
  onClose,
  onDelete,
  hasServerData = true,
}: {
  /** Whether the connection names a server data folder, which looks are named from. */
  hasServerData?: boolean;
  /** The project's NPCs, objects and items */
  entities: ProjectEntities;
  onChange(next: ProjectEntities): void;
  /** The project's quests and what each uses: for the delete question and the quest an object is limited to */
  quests: readonly ProjectQuestUse[];
  state: EditorState;
  onTab(tab: string): void;
  onClose(): void;
  /** Takes the entity out of the project (and off the quests' cards); the editor closes once it is done */
  onDelete?(kind: 'npc' | 'object' | 'item', entry: number): void | Promise<unknown>;
}): React.JSX.Element | null {
  const api = useApi();
  const npc = state.kind === 'npc' ? entities.npcs.find((n) => n.entry === state.entry) : undefined;
  const object = state.kind === 'object' ? entities.objects.find((o) => o.entry === state.entry) : undefined;
  const item = state.kind === 'item' ? entities.items.find((i) => i.entry === state.entry) : undefined;
  const entity = npc ?? object ?? item;
  // The tab shown follows a click at once, whether or not the caller passes it back, and follows the caller when it moves
  const [tab, setTab] = useState(state.tab);
  useEffect(() => setTab(state.tab), [state.tab]);
  const chooseTab = (id: string): void => {
    setTab(id);
    onTab(id);
  };
  // The advanced item fields list the database's own columns, read once per editor.
  const [itemColumns, setItemColumns] = useState<ColumnInfo[]>([]);
  const isItem = state.kind === 'item';
  useEffect(() => {
    if (!isItem || !api) return;
    let live = true;
    void api.itemColumns().then((r) => {
      if (live && r.ok) setItemColumns(r.value);
    });
    return () => {
      live = false;
    };
  }, [api, isItem]);

  useEffect(() => {
    if (!entity) onClose();
  }, [entity, onClose]);
  if (!entity) return null;

  const word = { npc: 'NPC', object: 'object', item: 'item' }[state.kind];
  const Word = { npc: 'NPC', object: 'Object', item: 'Item' }[state.kind];
  const existing: ExistingFacts | undefined =
    entity.origin.kind === 'existing'
      ? { sharedLoot: entity.origin.sharedLoot, spawnCount: entity.origin.spawnCount, locked: entity.origin.locked }
      : undefined;
  const title = state.isNew ? `New ${word}` : `${Word}: ${entity.name.trim() || entity.entry}${existing ? ' (existing)' : ''}`;
  const useKey = state.kind === 'npc' ? 'npcs' : state.kind === 'object' ? 'objects' : 'items';
  const users = quests.filter((q) => q.uses[useKey].includes(state.entry));
  // The quests that use it first, then the rest, for the quest an object is limited to
  const questChoices = [...users, ...quests.filter((q) => !users.includes(q))].map((q) => ({ questId: q.questId, title: q.title.trim() || `Quest ${q.questId}` }));

  async function allocate(kind: AllocKind): Promise<number | null> {
    const result = await api?.allocateIds(kind, 1);
    return result?.ok && result.value.length > 0 ? result.value[0]! : null;
  }

  const saveNpc = (next: CustomNpc): void => onChange({ ...entities, npcs: entities.npcs.map((n) => (n.entry === next.entry ? next : n)) });
  const saveObject = (next: CustomObject): void => onChange({ ...entities, objects: entities.objects.map((o) => (o.entry === next.entry ? next : o)) });
  const saveItem = (next: CustomItem): void => onChange({ ...entities, items: entities.items.map((i) => (i.entry === next.entry ? next : i)) });
  async function copyLook(entry: number): Promise<Partial<CustomItem> | null> {
    const result = await api?.entityTemplate('item', entry);
    return result?.ok && result.value ? (result.value as Partial<CustomItem>) : null;
  }

  const withoutIt = (): ProjectEntities =>
    ({ ...entities, [useKey]: (entities[useKey] as { entry: number }[]).filter((e) => e.entry !== state.entry) }) as ProjectEntities;

  function putBack(): void {
    const name = entity!.name.trim() || `this ${word}`;
    if (!window.confirm(`Put back ${name} as the database has it? The changes made to it here are dropped.`)) return;
    // Never onDelete: the quests naming it still name it, as the database has it
    onChange(withoutIt());
    onClose();
  }

  async function remove(): Promise<void> {
    const verb = state.isNew ? 'Discard' : 'Delete';
    const name = entity!.name.trim() || `this ${word}`;
    const titles = users.map((q) => q.title.trim() || `Quest ${q.questId}`);
    const question =
      titles.length === 0
        ? `${verb} ${name}? It is removed from the project.`
        : titles.length === 1
          ? `${verb} ${name}? Quest ${quoted(titles)} names it; its giver cards will be emptied.`
          : `${verb} ${name}? Quests ${quoted(titles)} name it; their giver cards will be emptied.`;
    if (!window.confirm(question)) return;
    if (onDelete) await onDelete(state.kind, state.entry);
    else onChange(withoutIt());
    onClose();
  }

  const needs = stillNeeds(entity, state.kind);
  const footer = (
    <>
      <span className="scene-hint">{needs && `Still needs ${needs}.`}</span>
      <span className="entry-card__actions">
        {existing ? (
          <button type="button" className="btn entry-card__btn--danger" onClick={putBack}>
            Put back as the database has it
          </button>
        ) : (
          <button type="button" className="btn entry-card__btn--danger" onClick={() => void remove()}>
            {state.isNew ? 'Discard' : `Delete ${word}`}
          </button>
        )}
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </span>
    </>
  );

  return (
    <PanelFrame title={title} onClose={onClose} footer={footer}>
      {existing && existing.spawnCount > 1 && (
        <p className="scene-hint">{entity.name.trim() || `This ${word}`} has {existing.spawnCount} spawns in the world: changes here change all of them.</p>
      )}
      {npc && (
        <NpcEditor npc={npc} onChange={saveNpc} allocateSpawn={() => allocate('creatureSpawn')} tab={tab} onTab={chooseTab}
          others={entities.npcs.filter((n) => n.entry !== npc.entry)} hasServerData={hasServerData} quests={questChoices} existing={existing} />
      )}
      {object && (
        <ObjectEditor object={object} onChange={saveObject} allocateSpawn={() => allocate('gameobjectSpawn')} allocatePage={() => allocate('page')}
          tab={tab} onTab={chooseTab} hasServerData={hasServerData} quests={questChoices} existing={existing} />
      )}
      {item && (
        <ItemEditor item={item} onChange={saveItem} allocatePage={() => allocate('page')} copyLook={copyLook} columns={itemColumns} tab={tab} onTab={chooseTab} existing={existing} />
      )}
    </PanelFrame>
  );
}
