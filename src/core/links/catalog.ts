import type { ComponentDef } from './component';
import type { ComponentId } from './model';
import { QUEST_COLUMN_COMPONENTS } from './components/quest-columns';
import { GROUP_COMPONENTS } from './components/groups';
import { RELATION_COMPONENTS } from './components/relations';

/**
 * The full list of built-in components, in claim-priority order: `recogniseLinks` walks this list
 * front to back, so a component earlier here wins a contested row over one later. Later tasks append
 * their own components to the end; nothing here is removed or reordered without checking those claims.
 */

const byId = new Map(QUEST_COLUMN_COMPONENTS.map((c) => [c.id, c]));
const finishAll = GROUP_COMPONENTS.find((c) => c.id === 'group.finishAll')!;
const pickOne = GROUP_COMPONENTS.find((c) => c.id === 'group.pickOne')!;

export const CATALOG: readonly ComponentDef[] = [
  finishAll,
  pickOne,
  byId.get('unlock.afterTurnIn')!,
  byId.get('unlock.whileInLog')!,
  byId.get('unlock.nextQuest')!,
  byId.get('start.offeredStraightAway')!,
  byId.get('gate.breadcrumb')!,
  ...RELATION_COMPONENTS,
];

const catalogById = new Map(CATALOG.map((c) => [c.id, c]));

export function componentById(id: ComponentId): ComponentDef {
  const component = catalogById.get(id);
  if (!component) throw new Error(`Unknown component ${id}`);
  return component;
}
