import type { CustomItem } from '@core/entities/model';
import type { ColumnInfo } from '@core/db/types';
import { advancedColumnGroups } from '@core/entities/item-columns';
import { TextField } from '../../scripts/fields';

/**
 * Every other `item_template` column the database has, grouped, as raw values. An empty box means
 * the column's default, so clearing one removes it from the item.
 */
export function ItemAdvanced({ item, onChange, columns }: { item: CustomItem; onChange(next: CustomItem): void; columns: readonly ColumnInfo[] }): React.JSX.Element {
  const groups = advancedColumnGroups(columns);
  const setColumn = (column: string, value: string): void => {
    const advanced = { ...item.advanced };
    if (value.trim() === '') delete advanced[column];
    else advanced[column] = value;
    onChange({ ...item, advanced });
  };
  return (
    <div className="scripts-body">
      {groups.length === 0 && <p className="scene-hint">The database's item columns could not be read, so there is nothing more to set.</p>}
      {groups.map(({ group, columns: cols }) => (
        <fieldset key={group} aria-label={group} className="scene-section">
          <legend className="scene-section__title">{group}</legend>
          {cols.map((c) => (
            <TextField key={c.name} label={c.name} value={item.advanced[c.name] ?? ''} onChange={(v) => setColumn(c.name, v)} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
