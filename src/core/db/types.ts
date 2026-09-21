/** A database value carried as text end to end; `null` is SQL NULL. */
export type RawValue = string | null;

/** One row keyed by column name, all values as text. */
export type RawRow = Readonly<Record<string, RawValue>>;

/** Equality filter: column -> one value, or any of several values. */
export type Where = Readonly<Record<string, string | readonly string[]>>;

export type RefKind =
  | 'item'
  | 'creature'
  | 'gameobject'
  | 'quest'
  | 'spell'
  | 'faction'
  | 'title'
  | 'areatrigger'
  | 'map'
  | 'emote'
  | 'zone'
  | 'skill'
  | 'mailTemplate';
