import type { SpawnInfo } from '../scene/spawn/SpawnManager';
import type { QuestRoles, Role } from '@core/modules/quest-roles';
import { worldItems } from './world-items';
import { movementItems } from './movement-items';
import { questItems } from './quest-items';

/**
 * The 3D view's right-click menu as data: what was right-clicked (the target), what the view and the
 * open quest allow (the context), and the groups of items each domain offers for them. Building it is
 * pure; the view runs the action an item carries.
 */

export type At = { x: number; y: number; z: number };
export type MenuSpawn = SpawnInfo;

export interface MenuTarget {
  /** The ground under the right-click, or null for sky */
  ground: At | null;
  hit: { type: 'spawn'; spawn: MenuSpawn } | { type: 'point'; guid: number; index: number } | null;
  /** The spawns selected once the right-click has selected what it hit */
  selection: MenuSpawn[];
}

export interface QuestMenuInfo {
  id: number;
  title: string;
  /** Entries by role in the open quest */
  roles: QuestRoles;
  /** The chain has quests besides this one */
  chained: boolean;
}

export interface MenuContext {
  map: number;
  /** The world database is there: existing NPCs and objects can be placed */
  connected: boolean;
  /** How many spawns are copied, and why they cannot be pasted here (null when they can) */
  clipboard: { count: number; blocked: string | null };
  placing: boolean;
  drawing: { guid: number; points: number } | null;
  quest: QuestMenuInfo | null;
  /** A project is open: a new quest can be started */
  project: boolean;
  /** Quest spawns are marked in the view */
  marked: boolean;
  /** Whether a project object can be looted; null for an entry that is not one of the project's objects */
  lootable(entry: number): boolean | null;
}

export type MenuAction =
  | { kind: 'stopPlacing' }
  | { kind: 'finishPath' }
  | { kind: 'undoPoint' }
  | { kind: 'cancelPath' }
  | { kind: 'placeHere'; what: 'creature' | 'object'; at: At }
  /** A new project NPC or object standing here; `forQuest` makes it for the open quest */
  | { kind: 'newEntity'; what: 'creature' | 'object'; at: At; forQuest: boolean }
  | { kind: 'editEntity'; spawn: MenuSpawn }
  | { kind: 'setLootable'; spawn: MenuSpawn; on: boolean }
  | { kind: 'copy' }
  | { kind: 'paste'; at: At }
  | { kind: 'duplicate' }
  | { kind: 'remove'; spawn: MenuSpawn }
  | { kind: 'copyCoordinates'; at: At }
  | { kind: 'startPath'; spawn: MenuSpawn; at: At }
  | { kind: 'wander'; spawn: MenuSpawn }
  | { kind: 'removePath'; spawn: MenuSpawn }
  | { kind: 'toggleRole'; role: Role; spawn: MenuSpawn; on: boolean }
  | { kind: 'newQuest'; spawn: MenuSpawn; after: boolean }
  | { kind: 'showSpawns'; scope: 'quest' | 'chain' }
  | { kind: 'hideSpawns' };

export interface MenuItem {
  id: string;
  label: string;
  action?: MenuAction;
  /** Why the item cannot run now; it is shown, disabled, with this */
  disabledReason?: string;
  /** A role the target has (shown with a check) or not */
  checked?: boolean;
  children?: MenuItem[];
}

export interface MenuGroup {
  id: 'state' | 'world' | 'movement' | 'quest';
  items: MenuItem[];
}

export type MenuProvider = (target: MenuTarget, context: MenuContext) => MenuGroup | null;

/** A stable id from a label, without counts: "Paste here (3)" is `paste-here` */
export const itemId = (label: string): string =>
  label
    .replace(/\(\d+\)|\s\d+$/g, '')
    .replace(/…/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const item = (label: string, rest: Omit<MenuItem, 'id' | 'label'> = {}): MenuItem => ({ id: itemId(label), label, ...rest });

/** What the view is busy with comes first: stop placing, or finish the path being drawn */
function stateItems(_target: MenuTarget, context: MenuContext): MenuGroup | null {
  if (context.drawing) {
    return {
      id: 'state',
      items: [
        item('Finish path', { action: { kind: 'finishPath' } }),
        item('Undo last point', { action: { kind: 'undoPoint' } }),
        item('Cancel path', { action: { kind: 'cancelPath' } }),
      ],
    };
  }
  if (context.placing) return { id: 'state', items: [item('Stop placing', { action: { kind: 'stopPlacing' } })] };
  return null;
}

export function buildMenu(target: MenuTarget, context: MenuContext): MenuGroup[] {
  // While a path is drawn, clicks add points: nothing else is offered until it is finished
  const providers: MenuProvider[] = context.drawing ? [stateItems] : [stateItems, worldItems, movementItems, questItems];
  return providers.map((provide) => provide(target, context)).filter((group): group is MenuGroup => group !== null && group.items.length > 0);
}
