import type { SelectionSummary } from './world3d';

/** How many of a thing, singular or plural */
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What the selection card says of a selection of several things: "3 NPCs, 1 object, 12 route points on 2 routes" */
export function summaryText({ creatures, objects, points, routes }: SelectionSummary): string {
  return [
    creatures > 0 && count(creatures, 'NPC'),
    objects > 0 && count(objects, 'object'),
    points > 0 && `${count(points, 'route point')} on ${count(routes, 'route')}`,
  ]
    .filter(Boolean)
    .join(', ');
}
