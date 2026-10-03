/**
 * The shapes items give a character's body (3.3.5): each item display names values in up to three
 * of the body's geoset groups (gloves, boots, sleeves, a robe's skirt…), and each group shows one
 * geoset, `group * 100 + 1 + value`. A value of 0 is the group's plain one.
 */

/** The places an NPC wears items, in an extra row's `itemDisplays` order */
export const OUTFIT_SLOTS = ['head', 'shoulders', 'shirt', 'chest', 'waist', 'legs', 'feet', 'wrists', 'hands', 'tabard', 'back'] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];

/**
 * The order items are painted on the body, lowest first: a shirt under everything, boots over
 * trousers, and the chest over both, so a robe's skirt covers them as it does in game
 */
export const PAINT_ORDER: OutfitSlot[] = ['shirt', 'legs', 'feet', 'wrists', 'chest', 'waist', 'hands', 'tabard'];

/** The order shapes are applied: the legs before the chest, so a chest's robe wins over the legs' */
export const SHAPE_ORDER: OutfitSlot[] = ['shirt', 'legs', 'chest', 'feet', 'waist', 'hands', 'tabard', 'back'];

/** Shows one geoset in a group, in place of whichever of the group showed */
function setGroup(geosets: Set<number>, group: number, value: number): void {
  for (const id of [...geosets]) if (id >= group * 100 && id < group * 100 + 100) geosets.delete(id);
  geosets.add(group * 100 + value);
}

/** The shapes one item gives, by the slot it is worn in and its display's three geoset values */
export function applyItemGeosets(geosets: Set<number>, slot: OutfitSlot, groups: number[]): void {
  const [g0 = 0, g1 = 0, g2 = 0] = groups;
  switch (slot) {
    case 'hands':
      setGroup(geosets, 4, 1 + g0);
      break;
    case 'feet':
      setGroup(geosets, 5, 1 + g0);
      break;
    case 'shirt':
      setGroup(geosets, 8, 1 + g0);
      break;
    case 'chest':
      setGroup(geosets, 8, 1 + g0);
      setGroup(geosets, 10, 1 + g1);
      if (g2 > 0) setGroup(geosets, 13, 1 + g2);
      break;
    case 'legs':
      setGroup(geosets, 11, 1 + g0);
      setGroup(geosets, 9, 1 + g1);
      if (g2 > 0) setGroup(geosets, 13, 1 + g2);
      break;
    case 'waist':
      setGroup(geosets, 18, 1 + g0);
      break;
    case 'tabard':
      setGroup(geosets, 12, 2);
      break;
    case 'back':
      setGroup(geosets, 15, 1 + g0);
      break;
    default:
      // A helmet, shoulders and bracers change no shape
      break;
  }
}
