import { describe, expect, it } from 'vitest';
import { localiseEdit } from '../../src/renderer/world3d/frame-edit';
import { IDENTITY_FRAME, placementToWorld } from '../../src/core/map/transport-frame';
import type { SpawnEdit } from '../../src/renderer/world3d/edits';

const ref = { kind: 'creature' as const, guid: 5, entry: 3, own: false };
const frame = { x: 100, y: 200, z: 5, heading: Math.PI / 2 };
const local = { x: 2, y: -1, z: 0.5, orientation: 1, rotation: null };

describe('turning the scene’s edits into vessel-local ones', () => {
  it('converts a move from world to local', () => {
    const edit: SpawnEdit = { kind: 'place', spawn: ref, to: placementToWorld(frame, local) };
    const out = localiseEdit(edit, frame) as Extract<SpawnEdit, { kind: 'place' }>;
    expect(out.to.x).toBeCloseTo(2);
    expect(out.to.y).toBeCloseTo(-1);
    expect(out.to.z).toBeCloseTo(0.5);
    expect(out.to.orientation).toBeCloseTo(1);
  });
  it('converts where a spawn is added or taken out, and keeps the map', () => {
    const edit: SpawnEdit = { kind: 'presence', spawn: ref, present: true, at: placementToWorld(frame, local), map: 591 };
    const out = localiseEdit(edit, frame) as Extract<SpawnEdit, { kind: 'presence' }>;
    expect(out.at.x).toBeCloseTo(2);
    expect(out.map).toBe(591);
    expect(out.present).toBe(true);
  });
  it('drops a route edit: walking paths on a vessel are not edited yet', () => {
    expect(localiseEdit({ kind: 'route', spawn: ref, pathId: 1, points: [{ x: 1, y: 1, z: 1 }] }, frame)).toBeNull();
  });
  it('passes edits that carry no position through untouched', () => {
    const respawn: SpawnEdit = { kind: 'respawn', spawn: ref, secs: 60 };
    expect(localiseEdit(respawn, frame)).toBe(respawn);
  });
  it('changes nothing in the identity frame, and routes still pass', () => {
    const edit: SpawnEdit = { kind: 'place', spawn: ref, to: local };
    expect(localiseEdit(edit, IDENTITY_FRAME)).toBe(edit);
    const route: SpawnEdit = { kind: 'route', spawn: ref, pathId: 1, points: [] };
    expect(localiseEdit(route, IDENTITY_FRAME)).toBe(route);
  });
  it('is not applied twice by accident: converting a local placement again would move it', () => {
    const once = localiseEdit({ kind: 'place', spawn: ref, to: placementToWorld(frame, local) }, frame) as Extract<SpawnEdit, { kind: 'place' }>;
    const twice = localiseEdit(once, frame) as Extract<SpawnEdit, { kind: 'place' }>;
    expect(Math.hypot(twice.to.x - once.to.x, twice.to.y - once.to.y)).toBeGreaterThan(1);
  });
});
