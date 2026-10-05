// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { goToTarget } from '../../src/renderer/world3d/go-to-spawn';
import { errv, makeMockApi, okv } from './mock-api';

const entity = { entry: 1423, name: 'Stormwind Guard' };

describe('Go to a tracked spawn', () => {
  it('goes straight to a spawn whose place is known, without asking', async () => {
    const api = makeMockApi({ spawnPlacement: vi.fn(async () => okv({ x: 9, y: 9, z: 9 })) });
    const target = await goToTarget(api, { kind: 'creature', guid: 80330, map: 0, x: 1, y: 2, z: 3 }, entity);
    expect(target).toEqual({ kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, x: 1, y: 2, z: 3, event: null, added: false });
    expect(api.spawnPlacement).not.toHaveBeenCalled();
  });

  it('reads where a spawn changed without being moved stands, then goes there', async () => {
    const api = makeMockApi({ spawnPlacement: vi.fn(async () => okv({ x: 4, y: 5, z: 6 })) });
    const target = await goToTarget(api, { kind: 'object', guid: 70, map: 1 }, { entry: 1731, name: 'Copper Vein' });
    expect(api.spawnPlacement).toHaveBeenCalledWith('object', 70);
    expect(target).toEqual({ kind: 'object', guid: 70, entry: 1731, name: 'Copper Vein', map: 1, x: 4, y: 5, z: 6, event: null, added: false });
  });

  it('says so when the spawn is not there any more', async () => {
    const api = makeMockApi({ spawnPlacement: vi.fn(async () => okv(null)) });
    expect(await goToTarget(api, { kind: 'creature', guid: 80331, map: 0 }, entity)).toEqual({ error: 'Spawn 80331 is not in the database any more.' });
  });

  it('passes on an error reading it', async () => {
    const api = makeMockApi({ spawnPlacement: vi.fn(async () => errv('NOT_CONNECTED', 'Not connected.')) });
    expect(await goToTarget(api, { kind: 'creature', guid: 80331, map: 0 }, entity)).toEqual({ error: 'Not connected.' });
  });
});
