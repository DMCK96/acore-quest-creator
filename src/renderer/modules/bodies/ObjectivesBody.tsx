import type { CreatureOrGoValue, FieldValue, ListValue, ScalarValue } from '@core/registry/types';
import { creatureName, itemName, objectName } from '@core/modules/summaries';
import { removeEntry } from '@core/modules/entries';
import { DropsPanel } from '../../groups/DropsPanel';
import { useNameBook } from '../../state/names';
import type { ModuleBodyProps } from '../body-props';
import { FieldSetting } from '../FieldSetting';
import { ListFieldEditor } from '../ListFieldEditor';
import '../modules.css';

const REQUIRED_ITEMS = 'quest_template.RequiredItems';
const START_ITEM = 'quest_template.StartItem';
const TRIGGERS = 'areatrigger_involvedrelation';

type Entry = Record<string, ScalarValue>;

/** The required items and the start item, once each, in the order their drops should list. */
function dropItemIds(values: Record<string, FieldValue>): number[] {
  const ids: number[] = [];
  const add = (id: unknown): void => {
    if (typeof id === 'number' && id !== 0 && !ids.includes(id)) ids.push(id);
  };
  for (const row of (values[REQUIRED_ITEMS] as ListValue | undefined) ?? []) add(row.item);
  add(values[START_ITEM]);
  return ids;
}

/** What the player must do: kill or use targets, items to collect with where they drop, places to explore. */
export function ObjectivesBody({ open, onChange }: ModuleBodyProps): React.JSX.Element {
  const { aggregate } = open;
  const names = useNameBook();
  const itemIds = dropItemIds(aggregate.values);
  const triggers = (aggregate.values[TRIGGERS] as Entry[] | undefined) ?? null;

  const killTitle = (e: Entry): string => {
    const t = e.target as CreatureOrGoValue | null;
    if (!t || t.id === 0) return 'Choose a target';
    return t.target === 'creature'
      ? `Kill ${e.count} × ${creatureName(t.id, names)}`
      : `Use ${e.count} × ${objectName(t.id, names)}`;
  };
  const collectTitle = (e: Entry): string =>
    e.item ? `Collect ${e.count} × ${itemName(Number(e.item), names)}` : 'Choose an item';

  return (
    <div>
      <h3 className="module-section__title">Kill or use</h3>
      <ListFieldEditor fieldId="quest_template.RequiredNpcOrGo" aggregate={aggregate} onChange={onChange}
        noun="kill or use target" addLabel="Add kill or use" title={killTitle} />

      <h3 className="module-section__title">Collect</h3>
      <ListFieldEditor fieldId={REQUIRED_ITEMS} aggregate={aggregate} onChange={onChange}
        noun="collect item" addLabel="Add collect" title={collectTitle} />
      {itemIds.length > 0 && (
        <>
          <h3 className="module-section__title">Drop sources</h3>
          {itemIds.map((itemId) => (
            <DropsPanel key={itemId} itemId={itemId} values={aggregate.values} sharedItems={aggregate.sharedItems} onChange={onChange} />
          ))}
        </>
      )}

      {triggers && (
        <>
          <h3 className="module-section__title">Explore</h3>
          <div className="entry-list" data-field={TRIGGERS}>
            {triggers.map((row, i) => (
              <section key={i} className="entry-card" aria-label={`explore ${i + 1}`}>
                <label htmlFor={`${TRIGGERS}.${i}`}>{`Area trigger ID ${i + 1}`}</label>
                <input
                  id={`${TRIGGERS}.${i}`}
                  inputMode="numeric"
                  value={String(row.id ?? 0)}
                  onChange={(e) => {
                    if (!/^\d+$/.test(e.target.value)) return;
                    onChange(TRIGGERS, triggers.map((r, j) => (j === i ? { ...r, id: Number(e.target.value) } : r)));
                  }}
                />
                <button type="button" className="entry-card__btn entry-card__btn--danger" aria-label={`Remove explore ${i + 1}`}
                  onClick={() => onChange(TRIGGERS, removeEntry(triggers, i))}>
                  Remove
                </button>
              </section>
            ))}
            <div className="entry-list__add">
              {/* One trigger per row, keyed on the trigger: a second blank card would collide. */}
              <button type="button" className="btn" disabled={triggers.some((r) => Number(r.id) === 0)}
                onClick={() => onChange(TRIGGERS, [...triggers, { id: 0 }])}>
                Add explore
              </button>
            </div>
          </div>
        </>
      )}

      <h3 className="module-section__title">Custom objective text</h3>
      <ListFieldEditor fieldId="quest_template.ObjectiveText" aggregate={aggregate} onChange={onChange}
        noun="objective text line" addLabel="Add objective text" title={(_, i) => `Line ${i + 1}`}
        help="Replaces the objective line the client builds, in objective order." />

      <h3 className="module-section__title">Quest items handed out</h3>
      <ListFieldEditor fieldId="quest_template.ItemDrops" aggregate={aggregate} onChange={onChange}
        noun="quest item" addLabel="Add quest item"
        title={(e) => (e.item ? itemName(Number(e.item), names) : 'Choose an item')} />

      <FieldSetting fieldId="quest_template.LogDescription" label="Objectives summary" aggregate={aggregate} onChange={onChange} />
    </div>
  );
}
