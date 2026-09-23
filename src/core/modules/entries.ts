/** Appends `entry` unless the list already holds `max` entries. */
export function addEntry<E>(list: readonly E[], entry: E, max: number): E[] {
  return list.length >= max ? [...list] : [...list, entry];
}

/** Drops the entry at `index`; an index out of range changes nothing. */
export function removeEntry<E>(list: readonly E[], index: number): E[] {
  return list.filter((_, i) => i !== index);
}

/** Moves the entry at `from` to `to`; either index out of range changes nothing. */
export function moveEntry<E>(list: readonly E[], from: number, to: number): E[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}
