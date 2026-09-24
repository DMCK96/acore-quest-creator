/**
 * The client's minimap tiles: one 256 px texture per grid, named through
 * `Textures\Minimap\md5translate.trs` (`<Dir>\map<col>_<row>.blp` → a hashed or plain file name).
 * The column is the server grid's gy and the row its gx: Northshire is `Azeroth\map32_48.blp`.
 */

export function parseMd5Translate(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || /^dir:/i.test(line)) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    out.set(line.slice(0, tab).trim().toLowerCase(), line.slice(tab + 1).trim());
  }
  return out;
}

export function minimapPath(translate: Map<string, string>, mapDir: string, gx: number, gy: number): string | null {
  const file = translate.get(`${mapDir}\\map${gy}_${gx}.blp`.toLowerCase());
  return file ? `Textures\\Minimap\\${file}` : null;
}
