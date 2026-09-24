import { useRef, useState } from 'react';
import { readGivers, writeGivers, type GiverTarget } from '@core/modules/givers';
import { removeEntry } from '@core/modules/entries';
import { readEntities } from '@core/entities/model';
import { EntityPicker } from '../../controls/EntityPicker';
import { QuestStartsList } from '../../views/QuestStartsList';
import { useMapOpener } from '../../map/MapOpener';
import { useEntityEditor } from '../../entities/EntityEditorContext';
import type { ModuleBodyProps } from '../body-props';
import { FieldSetting } from '../FieldSetting';
import '../modules.css';

const ROLES = [
  { role: 'start', list: 'Starts at', add: 'Add quest giver', tables: ['creature_queststarter', 'gameobject_queststarter'] },
  { role: 'end', list: 'Ends at', add: 'Add quest ender', tables: ['creature_questender', 'gameobject_questender'] },
] as const;

/** Who offers the quest and who takes it back, as NPC-or-object cards, plus how it starts. */
export function GiverBody({ open, links, onChange, onOpenQuest }: ModuleBodyProps): React.JSX.Element {
  const { aggregate } = open;
  const openMap = useMapOpener();
  const openEditor = useEntityEditor();
  const entities = readEntities(aggregate.values);
  // Edits made after waiting for the server start from the values as they are then.
  const valuesRef = useRef(aggregate.values);
  valuesRef.current = aggregate.values;
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  function write(role: 'start' | 'end', targets: GiverTarget[]): void {
    for (const [fieldId, value] of Object.entries(writeGivers(role, targets))) onChange(fieldId, value);
  }

  /** A new NPC or object made with this quest in its one editor, already a quest giver, put on the card at `index`. */
  async function newGiver(role: 'start' | 'end', index: number, kind: GiverTarget['kind']): Promise<void> {
    if (!openEditor || making) return;
    setMaking(true);
    // Read the cards as they are when the entity exists, not as they were when the button was pressed.
    const onCreated = (entry: number): void =>
      write(role, readGivers(valuesRef.current, role).map((t, i) => (i === index ? { kind, id: entry } : t)));
    try {
      const why = await openEditor(kind === 'creature'
        ? { kind: 'newNpc', preset: { questGiver: true }, onCreated }
        : { kind: 'newObject', preset: { type: 'questGiver' }, onCreated });
      setError(why);
    } finally {
      setMaking(false);
    }
  }

  return (
    <div>
      {error && <p className="scene-warning">{error}</p>}
      {ROLES.map(({ role, list, add, tables }) => {
        const targets = readGivers(aggregate.values, role);
        const set = (index: number, next: GiverTarget): void => write(role, targets.map((t, i) => (i === index ? next : t)));
        return (
          <section key={role} className="entry-list" data-field={tables[0]}>
            {/* Links jump to a field by `data-field`; both relation tables of the role land here. */}
            <span data-field={tables[1]} />
            <h3 className="module-section__title">{list}</h3>
            {targets.map((t, i) => {
              const n = i + 1;
              const id = `giver.${role}.${i}`;
              const own = t.kind === 'creature' ? entities.npcs.find((npc) => npc.entry === t.id) : undefined;
              const ownObject = t.kind === 'gameobject' ? entities.objects.find((o) => o.entry === t.id) : undefined;
              const firstSpawn = own?.spawns[0];
              return (
                <section key={i} className="entry-card" aria-label={`${list} ${n}`}>
                  <div className="entry-card__target">
                    <label htmlFor={`${id}.kind`}>{`${list} kind ${n}`}</label>
                    <select id={`${id}.kind`} value={t.kind}
                      onChange={(e) => set(i, { kind: e.target.value as GiverTarget['kind'], id: 0 })}>
                      <option value="creature">NPC</option>
                      <option value="gameobject">Object</option>
                    </select>
                    <EntityPicker id={id} label={`${list} ${n}`} kind={t.kind} value={t.id}
                      onChange={(picked) => set(i, { kind: t.kind, id: picked })} />
                    {openEditor && (
                      <button type="button" className="entry-card__btn" disabled={making}
                        aria-label={`${t.kind === 'creature' ? 'New NPC' : 'New object'} for ${list.toLowerCase()} ${n}`}
                        onClick={() => void newGiver(role, i, t.kind)}>
                        {t.kind === 'creature' ? 'New NPC' : 'New object'}
                      </button>
                    )}
                  </div>
                  {ownObject && (
                    <div className="entry-card__own">
                      <strong>{ownObject.name.trim() || `New object ${ownObject.entry}`}</strong>
                      <p className="scene-hint">Made with this quest.</p>
                      {openEditor && (
                        <button type="button" className="entry-card__btn" onClick={() => void openEditor({ kind: 'object', entry: ownObject.entry })}>
                          Edit object
                        </button>
                      )}
                    </div>
                  )}
                  {own && (
                    <div className="entry-card__own">
                      <strong>{own.name.trim() || `New NPC ${own.entry}`}</strong>
                      <p className="scene-hint">Made with this quest.</p>
                      {openEditor && (
                        <button type="button" className="entry-card__btn" onClick={() => void openEditor({ kind: 'npc', entry: own.entry })}>
                          Edit NPC
                        </button>
                      )}
                      {openMap && !firstSpawn && (
                        <button type="button" className="entry-card__btn"
                          onClick={() => openMap({ kind: 'place', target: { kind: 'npc', entry: own.entry } })}>
                          Place on map
                        </button>
                      )}
                      {openMap && firstSpawn && (
                        <>
                          <button type="button" className="entry-card__btn" onClick={() => openMap(`spawn:npc:${own.entry}:${firstSpawn.guid}`)}>
                            Show on map
                          </button>
                          <button type="button" className="entry-card__btn"
                            onClick={() => openMap({ kind: 'patrol', entry: own.entry, guid: firstSpawn.guid })}>
                            Draw patrol
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <div className="entry-card__actions">
                    <button type="button" className="entry-card__btn entry-card__btn--danger"
                      aria-label={`Remove ${list.toLowerCase()} ${n}`} onClick={() => write(role, removeEntry(targets, i))}>
                      Remove
                    </button>
                  </div>
                </section>
              );
            })}
            <div className="entry-list__add">
              {/* The table is keyed on the ID, so a second blank card would be a duplicate row. */}
              <button type="button" className="btn" disabled={targets.some((t) => t.id === 0)}
                onClick={() => write(role, [...targets, { kind: 'creature', id: 0 }])}>
                {add}
              </button>
            </div>
          </section>
        );
      })}
      <FieldSetting fieldId="quest_template.StartItem" label="Started by item" aggregate={aggregate} onChange={onChange} />
      <FieldSetting fieldId="quest_template_addon.ProvidedItemCount" label="How many of the start item"
        aggregate={aggregate} onChange={onChange} />
      <h3 className="module-section__title">How this quest starts</h3>
      <QuestStartsList links={links} questId={open.questId} onOpenQuest={onOpenQuest} />
    </div>
  );
}
