import { item } from '../model';
import { NEEDS_DATABASE, type MenuSection } from '../section';
import type { RoutePointSubject } from './kinds';

/** A point of a route: what the NPC does there (its wait, pace, facing and, for a project NPC, actions) */
export const routePoint: MenuSection<RoutePointSubject> = {
  id: 'route-point',
  group: 'movement',
  appliesTo: (subject, context): subject is RoutePointSubject => !context.placing && subject.type === 'routePoint',
  items: (subject, context) => {
    const label = 'Point settings…';
    // A route the database has is read from it at its first edit
    if (!subject.own && !context.connected) return [item(label, { disabledReason: NEEDS_DATABASE })];
    return [item(label, { action: { kind: 'pointSettings', guid: subject.guid, index: subject.index } })];
  },
};
