import { useState } from 'react';
import { ENTITIES_FIELD, newNpc, newObject, readEntities, writeEntities, type CustomNpc, type CustomObject, type QuestEntities } from '@core/entities/model';
import type { AllocKind } from '@shared/ipc';
import { EntityPicker } from '../../controls/EntityPicker';
import { NpcCard, ObjectCard } from '../../entities/EntityCard';
import { useApi } from '../../state/names';
import type { ModuleBodyProps } from '../body-props';
import '../../scripts/scripts.css';

/** New NPCs and objects the quest needs: added (optionally copied from existing ones), edited and placed. */
export function EntitiesBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const entities = readEntities(open.aggregate.values);
  const api = useApi();
  const [npcFrom, setNpcFrom] = useState(0);
  const [objectFrom, setObjectFrom] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Adding is asynchronous, so later edits build on the newest list rather than the one rendered.
  const save = (next: QuestEntities): void => onChange(ENTITIES_FIELD, writeEntities(next));

  async function allocate(kind: AllocKind): Promise<number | null> {
    const result = await api?.allocateIds(kind, 1);
    if (!result?.ok || result.value.length === 0) {
      setError(result && !result.ok ? result.error.message : 'No free ID could be found.');
      return null;
    }
    setError(null);
    return result.value[0]!;
  }

  async function addNpc(): Promise<void> {
    const entry = await allocate('creature');
    if (entry === null) return;
    let npc: CustomNpc = newNpc(entry);
    if (npcFrom > 0) {
      const copied = await api?.entityTemplate('creature', npcFrom);
      if (copied?.ok && copied.value) npc = { ...npc, ...(copied.value as Partial<CustomNpc>), entry, spawns: [] };
    }
    save({ ...entities, npcs: [...entities.npcs, npc] });
  }

  async function addObject(): Promise<void> {
    const entry = await allocate('gameobject');
    if (entry === null) return;
    let object: CustomObject = newObject(entry);
    if (objectFrom > 0) {
      const copied = await api?.entityTemplate('gameobject', objectFrom);
      if (copied?.ok && copied.value) object = { ...object, ...(copied.value as Partial<CustomObject>), entry, spawns: [] };
    }
    save({ ...entities, objects: [...entities.objects, object] });
  }

  return (
    <div className="scripts-body">
      <p className="scene-hint">
        These are new NPCs and objects, written with this quest. Removing one here does not remove rows an earlier export or apply
        already put in the database.
      </p>
      {error && <p className="scene-warning">{error}</p>}
      <div className="scripts-body__add">
        <EntityPicker id="entities-npc-from" label="Copy from (optional)" kind="creature" value={npcFrom} onChange={setNpcFrom} />
        <button type="button" className="btn btn--primary" onClick={() => void addNpc()}>
          Add NPC
        </button>
      </div>
      <div className="scripts-body__add">
        <EntityPicker id="entities-object-from" label="Copy object from (optional)" kind="gameobject" value={objectFrom} onChange={setObjectFrom} />
        <button type="button" className="btn btn--primary" onClick={() => void addObject()}>
          Add object
        </button>
      </div>

      {entities.npcs.map((npc, i) => (
        <NpcCard
          key={npc.entry}
          npc={npc}
          onChange={(next) => save({ ...entities, npcs: entities.npcs.map((n, j) => (j === i ? next : n)) })}
          onRemove={() => save({ ...entities, npcs: entities.npcs.filter((_, j) => j !== i) })}
          allocateSpawn={() => allocate('creatureSpawn')}
        />
      ))}
      {entities.objects.map((object, i) => (
        <ObjectCard
          key={object.entry}
          object={object}
          onChange={(next) => save({ ...entities, objects: entities.objects.map((o, j) => (j === i ? next : o)) })}
          onRemove={() => save({ ...entities, objects: entities.objects.filter((_, j) => j !== i) })}
          allocateSpawn={() => allocate('gameobjectSpawn')}
          allocatePage={() => allocate('page')}
        />
      ))}
    </div>
  );
}
