import { describe, expect, it } from 'vitest';
import { summaryText } from '../../src/renderer/world3d/summary';

describe('the selection summary', () => {
  it('counts each kind, singular or plural, route points with their routes', () => {
    expect(summaryText({ creatures: 3, objects: 1, points: 12, routes: 2 })).toBe('3 NPCs, 1 object, 12 route points on 2 routes');
    expect(summaryText({ creatures: 1, objects: 0, points: 0, routes: 0 })).toBe('1 NPC');
    expect(summaryText({ creatures: 0, objects: 2, points: 0, routes: 0 })).toBe('2 objects');
    expect(summaryText({ creatures: 0, objects: 0, points: 1, routes: 1 })).toBe('1 route point on 1 route');
  });
});
