import { describe, expect, it } from 'vitest';
import { navigationTools } from '../../src/main/mcp/tools/navigation';
import { mcpFixture } from '../helpers/mcp-fixture';

const camera = { map: 1, x: 1629.36, y: -4373.39, z: 31.2, area: 'Orgrimmar' };

describe('the navigation MCP tools', () => {
  it('offers exactly these three, all read-only for the project', async () => {
    const { client } = await mcpFixture(navigationTools, { debug: {} });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['camera_status', 'teleport', 'teleport_search']);
  });

  it('camera_status asks the window', async () => {
    const { call } = await mcpFixture(navigationTools, { debug: { cameraStatus: async () => camera } });
    expect((await call('camera_status')).value).toEqual(camera);
  });

  it('teleport_search finds named places with their coordinates', async () => {
    const { call } = await mcpFixture(navigationTools, { debug: {} });
    const out = (await call('teleport_search', { query: 'orgrimmar', limit: 3 })).value;
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toMatchObject({ name: expect.stringMatching(/orgrimmar/i), map: expect.any(Number), x: expect.any(Number) });
  });

  it('teleport by coordinates sends them to the window and answers where the camera landed', async () => {
    const sent: unknown[] = [];
    const { call } = await mcpFixture(navigationTools, { debug: { cameraTeleport: async (t: unknown) => { sent.push(t); return camera; } } });
    const out = await call('teleport', { map: 1, x: 1629.36, y: -4373.39, z: 31.2 });
    expect(sent).toEqual([{ map: 1, x: 1629.36, y: -4373.39, z: 31.2 }]);
    expect(out.value).toEqual(camera);
  });

  it('teleport by name looks the place up in the teleport table', async () => {
    const sent: any[] = [];
    const { call } = await mcpFixture(navigationTools, { debug: { cameraTeleport: async (t: unknown) => { sent.push(t); return camera; } } });
    const out = await call('teleport', { spot: 'Stormwind City' });
    expect(out.isError).toBeFalsy();
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]).sort()).toEqual(['map', 'x', 'y', 'z']);
  });

  it('teleport refuses an unknown name, a half-given point, and a spot with coordinates, without reaching the window', async () => {
    const sent: unknown[] = [];
    const { call } = await mcpFixture(navigationTools, { debug: { cameraTeleport: async (t: unknown) => { sent.push(t); return camera; } } });
    expect((await call('teleport', { spot: 'zzzz nowhere' })).isError).toBe(true);
    expect((await call('teleport', { map: 1, x: 5 })).isError).toBe(true);
    expect((await call('teleport', { spot: 'Orgrimmar', map: 1, x: 1, y: 2, z: 3 })).isError).toBe(true);
    expect((await call('teleport', {})).isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it('teleport lists the candidates when a name is ambiguous', async () => {
    const { call } = await mcpFixture(navigationTools, { debug: { cameraTeleport: async () => camera } });
    const out = await call('teleport', { spot: 'a' });
    expect(out.isError).toBe(true);
    expect(out.value.candidates.length).toBeGreaterThan(1);
  });

  it('teleport passes the window\'s failure on', async () => {
    const { fail } = await import('../../src/main/api/errors');
    const { call } = await mcpFixture(navigationTools, { debug: { cameraTeleport: async () => { throw fail('BAD_REQUEST', 'The 3D view is not open.'); } } });
    const out = await call('teleport', { map: 1, x: 1, y: 2, z: 3 });
    expect(out.isError).toBe(true);
    expect(out.value.message).toMatch(/3D view/);
  });
});
