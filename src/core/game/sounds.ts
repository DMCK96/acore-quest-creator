import { dbcString, parseDbc } from './dbc';

/** Sound names from the server data folder's `SoundEntries.dbc`: field 0 the id, field 2 the name. */
export const SOUND_FILE = 'SoundEntries.dbc';

export interface SoundIndex {
  /** An id typed in full finds that sound alone; otherwise names starting with the text, then containing it. */
  search(text: string, limit: number): { id: number; name: string }[];
  get(id: number): string | undefined;
}

export function readSoundIndex(bytes: Uint8Array): SoundIndex {
  const names = new Map<number, string>();
  for (const record of parseDbc(bytes, SOUND_FILE).records) names.set(record[0]!, dbcString(bytes, record[2]!));
  const byId = [...names.entries()].sort(([a], [b]) => a - b);
  return {
    get: (id) => names.get(id),
    search(text, limit) {
      const needle = text.trim().toLowerCase();
      if (needle === '') return [];
      if (/^\d+$/.test(needle) && names.has(Number(needle))) return [{ id: Number(needle), name: names.get(Number(needle))! }];
      const starts: { id: number; name: string }[] = [];
      const contains: { id: number; name: string }[] = [];
      for (const [id, name] of byId) {
        const at = name.toLowerCase().indexOf(needle);
        if (at === 0) starts.push({ id, name });
        else if (at > 0) contains.push({ id, name });
      }
      return [...starts, ...contains].slice(0, limit);
    },
  };
}
