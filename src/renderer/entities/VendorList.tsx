import { useEffect, useState } from 'react';
import type { VendorItem } from '@core/entities/model';
import { formatCoin } from '@core/format/coin';
import { EntityField, NumberField } from '../scripts/fields';
import { useApi } from '../state/names';
import { useProjectEntities } from '../state/project-entities';

const NEW_ROW: VendorItem = { item: 0, maxCount: 0, restockSecs: 0, extendedCost: 0 };

/** A count the database holds as a whole number from 0 up */
const count = (n: number): number => Math.max(0, Math.round(n));

/** What a player pays in gold for an item: the project's own item, else the database's, shown once known */
function BuyPrice({ item }: { item: number }): React.JSX.Element | null {
  const api = useApi();
  const mine = useProjectEntities()?.entities.items.find((i) => i.entry === item);
  const [read, setRead] = useState<{ item: number; price: number } | null>(null);
  useEffect(() => {
    if (mine || item <= 0 || !api) return;
    let live = true;
    void api.entityTemplate('item', item).then((result) => {
      if (live && result.ok && result.value && 'buyPrice' in result.value) setRead({ item, price: result.value.buyPrice });
    });
    return () => {
      live = false;
    };
  }, [api, item, mine]);
  const price = mine ? mine.buyPrice : read?.item === item ? read.price : null;
  return price === null || item <= 0 ? null : <p className="scene-hint">Buy price: {formatCoin(price)}</p>;
}

/** What a new or existing NPC sells: each item with how many it has, how often it restocks and what besides gold it costs */
export function VendorList({
  idPrefix, vendor, onChange, hasServerData,
}: { idPrefix: string; vendor: readonly VendorItem[]; onChange(next: VendorItem[]): void; hasServerData: boolean }): React.JSX.Element {
  const set = (i: number, row: VendorItem): void => onChange(vendor.map((r, j) => (j === i ? row : r)));
  const move = (i: number, by: -1 | 1): void => {
    const next = [...vendor];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Vendor</h4>
      {vendor.length === 0 ? (
        <>
          <p className="scene-hint">This NPC sells nothing. Once it has something to sell, players can trade with it.</p>
          <button type="button" className="btn" onClick={() => onChange([{ ...NEW_ROW }])}>
            Make this NPC a vendor
          </button>
        </>
      ) : (
        <>
          <p className="scene-hint">Max count 0 is unlimited. The price in gold is the item&apos;s buy price.</p>
          <ol className="scene-steps">
            {vendor.map((row, i) => (
              <li key={i} className="scene-step">
                <div className="scene-step__head">
                  <strong>Item {i + 1}</strong>
                  <button type="button" className="entry-card__btn" disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
                  <button type="button" className="entry-card__btn" disabled={i === vendor.length - 1} onClick={() => move(i, 1)}>Down</button>
                  <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(vendor.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
                <EntityField id={`${idPrefix}-vendor${i}`} label="Item" kind="item" value={row.item} onChange={(item) => set(i, { ...row, item })} />
                <BuyPrice item={row.item} />
                <div className="scene-row">
                  <NumberField label="Max count" value={row.maxCount} min={0} onChange={(n) => set(i, { ...row, maxCount: count(n) })} />
                  <NumberField label="Restock (seconds)" value={row.maxCount === 0 ? 0 : row.restockSecs} min={0} disabled={row.maxCount === 0}
                    onChange={(n) => set(i, { ...row, restockSecs: count(n) })} />
                </div>
                {hasServerData ? (
                  <EntityField id={`${idPrefix}-vendor${i}-cost`} label="Extended cost" kind="extendedCost" value={row.extendedCost}
                    onChange={(extendedCost) => set(i, { ...row, extendedCost })} />
                ) : (
                  <>
                    <NumberField label="Extended cost (id)" value={row.extendedCost} min={0} onChange={(n) => set(i, { ...row, extendedCost: count(n) })} />
                    <p className="scene-hint">Names need the server data folder.</p>
                  </>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="btn" onClick={() => onChange([...vendor, { ...NEW_ROW }])}>
            Add item
          </button>
        </>
      )}
    </div>
  );
}
