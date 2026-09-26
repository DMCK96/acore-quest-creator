import type { Bonding, CustomItem, ItemQuality } from '@core/entities/model';
import { INVENTORY_TYPES, ITEM_CLASSES, ITEM_SUBCLASSES } from '@core/entities/item-vocab';
import { EntityField, NumberField, SelectField, TextField } from '../../scripts/fields';
import { NumberSelect } from './NumberSelect';

export const QUALITIES: readonly (readonly [ItemQuality, string])[] = [
  ['poor', 'Poor'], ['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['epic', 'Epic'],
  ['legendary', 'Legendary'], ['artifact', 'Artifact'], ['heirloom', 'Heirloom'],
];

const BONDINGS: readonly (readonly [Bonding, string])[] = [
  ['none', 'Not bound'], ['pickup', 'Binds when picked up'], ['equip', 'Binds when equipped'], ['use', 'Binds when used'], ['quest', 'Quest item'],
];

/** What the item is, how it looks, and what it costs: the fields every item has. */
export function ItemBasics({
  item,
  onChange,
  copyLook,
}: {
  item: CustomItem;
  onChange(next: CustomItem): void;
  copyLook(entry: number): Promise<Partial<CustomItem> | null>;
}): React.JSX.Element {
  const set = (patch: Partial<CustomItem>): void => onChange({ ...item, ...patch });
  const subclasses = ITEM_SUBCLASSES[item.itemClass];
  async function copyFrom(entry: number): Promise<void> {
    if (entry <= 0) return;
    const look = await copyLook(entry);
    if (look) set({ displayId: look.displayId ?? item.displayId, itemClass: look.itemClass ?? item.itemClass, subclass: look.subclass ?? item.subclass, inventoryType: look.inventoryType ?? item.inventoryType });
  }
  return (
    <div className="scripts-body">
      <TextField label="Name" value={item.name} onChange={(name) => set({ name })} />
      <TextField label="Description" long value={item.description} onChange={(description) => set({ description })} />
      <SelectField label="Quality" value={item.quality} options={QUALITIES} onChange={(quality) => set({ quality })} />
      {/* A new class has its own subclass list, so the subclass starts again from the first. */}
      <NumberSelect label="Class" value={item.itemClass} options={ITEM_CLASSES} onChange={(itemClass) => set({ itemClass, subclass: 0 })} />
      {subclasses ? (
        <NumberSelect label="Subclass" value={item.subclass} options={subclasses} onChange={(subclass) => set({ subclass })} />
      ) : (
        <NumberField label="Subclass" value={item.subclass} min={0} onChange={(subclass) => set({ subclass })} />
      )}
      <NumberSelect label="Worn in" value={item.inventoryType} options={INVENTORY_TYPES} onChange={(inventoryType) => set({ inventoryType })} />
      <NumberField label="Display ID" value={item.displayId} min={0} onChange={(displayId) => set({ displayId })} />
      <EntityField id={`item-${item.entry}-copy-look`} label="Copy look from an item" kind="item" value={0} onChange={(entry) => void copyFrom(entry)} />
      <NumberField label="Item level" value={item.itemLevel} min={0} onChange={(itemLevel) => set({ itemLevel })} />
      <NumberField label="Required level" value={item.requiredLevel} min={0} onChange={(requiredLevel) => set({ requiredLevel })} />
      <NumberField label="Stack size" value={item.stackable} min={1} onChange={(stackable) => set({ stackable })} />
      <NumberField label="Most a player can carry (0 = no limit)" value={item.maxCount} min={0} onChange={(maxCount) => set({ maxCount })} />
      <SelectField label="Binding" value={item.bonding} options={BONDINGS} onChange={(bonding) => set({ bonding })} />
      <NumberField label="Buy price (copper)" value={item.buyPrice} min={0} onChange={(buyPrice) => set({ buyPrice })} />
      <NumberField label="Sell price (copper)" value={item.sellPrice} min={0} onChange={(sellPrice) => set({ sellPrice })} />
      <EntityField id={`item-${item.entry}-starts`} label="Starts a quest" kind="quest" value={item.startsQuest} onChange={(startsQuest) => set({ startsQuest })} />
    </div>
  );
}
