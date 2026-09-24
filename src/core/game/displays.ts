import { dbcString, parseDbc } from './dbc';

/**
 * What a creature or object display looks like, in words, from the server data folder's dbc
 * files. Creatures built from a race's body (`CreatureDisplayInfoExtra`) read "Human male ·
 * armoured"; anything else, and every object, reads as its model file's name ("Basilisk",
 * "Chest02"). There is no picture: the words, and the NPCs that use a display, have to do.
 */

export const DISPLAY_FILES = {
  creatureDisplays: 'CreatureDisplayInfo.dbc',
  creatureModels: 'CreatureModelData.dbc',
  displayExtras: 'CreatureDisplayInfoExtra.dbc',
  races: 'ChrRaces.dbc',
  objectDisplays: 'GameObjectDisplayInfo.dbc',
} as const;

export interface DisplayIndex {
  /** An id typed in full finds that display; otherwise every word typed must be in its name. */
  search(text: string, limit: number): { id: number; name: string }[];
  get(id: number): string | undefined;
}

/** `CreatureDisplayInfoExtra` item displays that mean armour: helm, shoulders, chest and legs. */
const ARMOUR_SLOTS = [8, 9, 11, 13];

/** A model path's last part without its extension: `Creature\Basilisk\Basilisk.mdx` is `Basilisk`. */
export function modelName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

function indexOf(names: Map<number, string>): DisplayIndex {
  const byId = [...names.entries()].sort(([a], [b]) => a - b);
  return {
    get: (id) => names.get(id),
    search(text, limit) {
      const needle = text.trim().toLowerCase();
      if (needle === '') return [];
      if (/^\d+$/.test(needle) && names.has(Number(needle))) return [{ id: Number(needle), name: names.get(Number(needle))! }];
      const words = needle.split(/\s+/);
      const found: { id: number; name: string }[] = [];
      for (const [id, name] of byId) {
        const lower = name.toLowerCase();
        if (words.every((w) => lower.includes(w))) found.push({ id, name });
        if (found.length >= limit) break;
      }
      return found;
    },
  };
}

/** `CreatureDisplayInfo` 0 id, 1 model, 3 extra; `CreatureModelData` 0 id, 2 path; `CreatureDisplayInfoExtra` 0 id, 1 race, 2 sex; `ChrRaces` 0 id, 14 name. */
export function readCreatureDisplays(files: { displays: Uint8Array; models: Uint8Array; extras: Uint8Array; races: Uint8Array }): DisplayIndex {
  const models = new Map(parseDbc(files.models, DISPLAY_FILES.creatureModels).records.map((r) => [r[0]!, dbcString(files.models, r[2]!)]));
  const races = new Map(parseDbc(files.races, DISPLAY_FILES.races).records.map((r) => [r[0]!, dbcString(files.races, r[14]!)]));
  const extras = new Map(
    parseDbc(files.extras, DISPLAY_FILES.displayExtras).records.map((r) => [r[0]!, { race: r[1]!, sex: r[2]!, armoured: ARMOUR_SLOTS.some((i) => (r[i] ?? 0) !== 0) }]),
  );
  const names = new Map<number, string>();
  for (const r of parseDbc(files.displays, DISPLAY_FILES.creatureDisplays).records) {
    const extra = extras.get(r[3]!);
    const race = extra ? races.get(extra.race) : undefined;
    if (extra && race) {
      names.set(r[0]!, `${race} ${extra.sex === 1 ? 'female' : 'male'}${extra.armoured ? ' · armoured' : ''}`);
      continue;
    }
    const path = models.get(r[1]!);
    if (path) names.set(r[0]!, modelName(path));
  }
  return indexOf(names);
}

/** `GameObjectDisplayInfo` 0 id, 1 model path. */
export function readObjectDisplays(bytes: Uint8Array): DisplayIndex {
  const names = new Map<number, string>();
  for (const r of parseDbc(bytes, DISPLAY_FILES.objectDisplays).records) {
    const path = dbcString(bytes, r[1]!);
    if (path) names.set(r[0]!, modelName(path));
  }
  return indexOf(names);
}
