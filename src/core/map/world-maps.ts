/**
 * The continents the 3D view can draw, by the folder name their terrain lives under in the client
 * (`World\Maps\<name>\<name>.wdt`). Other maps (dungeons, battlegrounds) need their own WDT
 * handling and are not drawn yet.
 */
const CONTINENT_DIRECTORIES: Readonly<Record<number, string>> = {
  0: 'azeroth',
  1: 'kalimdor',
  530: 'expansion01',
  571: 'northrend',
};

/** The client folder of a map's terrain; null when the 3D view cannot draw that map. */
export function worldMapDirectory(map: number): string | null {
  return CONTINENT_DIRECTORIES[map] ?? null;
}
