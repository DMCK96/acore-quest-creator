import type { MenuSection } from '../section';
import { busy } from './busy';
import { create } from './create';
import { edit } from './edit';
import { loot } from './loot';
import { vendor } from './vendor';
import { trainer } from './trainer';
import { gossip } from './gossip';
import { clipboard } from './clipboard';
import { coordinates } from './coordinates';
import { respawn } from './respawn';
import { spawnEvents } from './spawn-events';
import { spawnGroup } from './spawn-group';
import { remove } from './remove';
import { movement } from './movement';
import { routePoint } from './route-point';
import { questParts } from './quest-parts';
import { questSpawns } from './quest-spawns';
import { vesselStops } from './vessel-stops';

/** Every section of the right-click menu, in the order their items are shown */
export const SECTIONS: readonly MenuSection[] = [
  busy, create, edit, loot, vendor, trainer, gossip, clipboard, coordinates, respawn, spawnEvents, spawnGroup, remove, movement, routePoint, questParts, questSpawns, vesselStops,
];
