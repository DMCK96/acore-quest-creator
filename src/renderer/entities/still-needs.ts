/**
 * What a new NPC, object or item still needs before it is usable in game ("a name and a look"), or
 * null. An item without a look still works (it shows as a question mark), so it only needs a name.
 */
export function stillNeeds(entity: { name: string; displayId: number }, kind: 'npc' | 'object' | 'item' = 'npc'): string | null {
  if (kind === 'item') return entity.name.trim() === '' ? 'a name' : null;
  const name = entity.name.trim() === '';
  const look = entity.displayId <= 0;
  if (name && look) return 'a name and a look';
  if (name) return 'a name';
  if (look) return 'a look';
  return null;
}
