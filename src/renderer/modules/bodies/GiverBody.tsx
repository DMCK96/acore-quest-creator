import { readGivers, writeGivers, type GiverTarget } from '@core/modules/givers';
import { removeEntry } from '@core/modules/entries';
import { EntityPicker } from '../../controls/EntityPicker';
import { QuestStartsList } from '../../views/QuestStartsList';
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

  function write(role: 'start' | 'end', targets: GiverTarget[]): void {
    for (const [fieldId, value] of Object.entries(writeGivers(role, targets))) onChange(fieldId, value);
  }

  return (
    <div>
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
                  </div>
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
