/** The 3.3.5a player classes by `ChrClasses.dbc` id; a class trainer serves one. The fork has classes of its own, shown by number. */
const CLASS_NAMES: ReadonlyArray<readonly [number, string]> = [
  [1, 'Warrior'],
  [2, 'Paladin'],
  [3, 'Hunter'],
  [4, 'Rogue'],
  [5, 'Priest'],
  [6, 'Death Knight'],
  [7, 'Shaman'],
  [8, 'Mage'],
  [9, 'Warlock'],
  [11, 'Druid'],
];

export const CLASSES: readonly { id: number; name: string }[] = CLASS_NAMES.map(([id, name]) => ({ id, name }));

const byId = new Map(CLASS_NAMES);

/** A class's name, or "Class N" for one this editor has no name for */
export const className = (id: number): string => byId.get(id) ?? `Class ${id}`;
