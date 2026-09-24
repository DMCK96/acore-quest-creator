/** What a new NPC or object still needs before it is usable in game ("a name and a look"), or null. */
export function stillNeeds(entity: { name: string; displayId: number }): string | null {
  const name = entity.name.trim() === '';
  const look = entity.displayId <= 0;
  if (name && look) return 'a name and a look';
  if (name) return 'a name';
  if (look) return 'a look';
  return null;
}
