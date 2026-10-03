/**
 * Converts AzerothAdmin's teleport table into the app's bundled teleport spots:
 *
 *   npx tsx scripts/teleports.ts "<client>/Interface/AddOns/AzerothAdmin/Data/TeleportTable.lua"
 *
 * The table is AzerothAdmin's (https://github.com/superstyro/AzerothAdmin, GPL-3.0-or-later, a
 * derivative of TrinityAdmin and MangAdmin); see CREDITS.md. Re-run it against a newer copy to refresh.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTeleportLua } from '../src/core/map/teleports';

const source = process.argv[2];
if (!source) {
  console.error('Give the path of AzerothAdmin\'s Data/TeleportTable.lua.');
  process.exit(1);
}
const spots = parseTeleportLua(readFileSync(source, 'utf8').replace(/^﻿/, ''));
const out = join(import.meta.dirname, '..', 'src', 'core', 'map', 'teleports.json');
writeFileSync(out, `${JSON.stringify(spots, null, 1)}\n`);
console.log(`${spots.length} teleport spots written to ${out}`);
