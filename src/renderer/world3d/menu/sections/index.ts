import type { MenuSection } from '../section';
import { busy } from './busy';
import { create } from './create';
import { edit } from './edit';
import { loot } from './loot';
import { clipboard } from './clipboard';
import { coordinates } from './coordinates';
import { respawn } from './respawn';
import { spawnGroup } from './spawn-group';
import { remove } from './remove';
import { movement } from './movement';
import { questParts } from './quest-parts';
import { questSpawns } from './quest-spawns';

/** Every section of the right-click menu, in the order their items are shown */
export const SECTIONS: readonly MenuSection[] = [
  busy, create, edit, loot, clipboard, coordinates, respawn, spawnGroup, remove, movement, questParts, questSpawns,
];
