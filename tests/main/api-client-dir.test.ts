import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

const STATUS = { dir: 'E:/Games/WoW', archives: ['common.MPQ'], problems: [] };

async function connectWith(clientDir: string | undefined) {
  const onClientDir = vi.fn();
  const clientStatus = vi.fn(async () => STATUS);
  const api = createApi({
    store: openStore(':memory:', box), openWorldDb: async () => forkDb(), openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, onClientDir, clientStatus,
  });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', ...(clientDir === undefined ? {} : { clientDir }) });
  const summary: any = await api.connect(rec.value.id);
  return { onClientDir, clientStatus, summary: summary.value };
}

describe('game client folder', () => {
  it("passes the profile's client folder on when connecting and reports it", async () => {
    const { onClientDir, summary } = await connectWith(' E:/Games/WoW ');
    expect(onClientDir).toHaveBeenCalledWith('E:/Games/WoW');
    expect(summary.clientDir).toBe('E:/Games/WoW');
    expect(summary.client).toEqual(STATUS);
  });
  it('reports no client folder when the profile names none', async () => {
    const { onClientDir, summary } = await connectWith(undefined);
    expect(onClientDir).toHaveBeenCalledWith(null);
    expect(summary.clientDir).toBeNull();
    expect(summary.client).toBeNull();
  });
  it('puts the folders back when a connect fails after naming new ones, keeping the old connection', async () => {
    const onClientDir = vi.fn();
    const onServerDataDir = vi.fn();
    const clientStatus = vi.fn(async () => STATUS);
    const api = createApi({
      store: openStore(':memory:', box), openWorldDb: async () => forkDb(), openDevDb: async () => { throw new Error('x'); },
      fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
      session: createProjectSession(defaultProjectMeta('P', 'C:\out')), projects: {} as ProjectController, onClientDir, onServerDataDir, clientStatus,
    });
    const save = (clientDir: string): any => api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', clientDir });
    const first: any = await save('E:/Old');
    const second: any = await save('E:/New');
    expect((await api.connect(first.value.id)).ok).toBe(true);
    clientStatus.mockRejectedValueOnce(new Error('The client folder could not be read'));
    expect((await api.connect(second.value.id)).ok).toBe(false);
    expect(onClientDir).toHaveBeenLastCalledWith('E:/Old');
    expect(onServerDataDir).toHaveBeenLastCalledWith(null);
    expect((await api.searchQuests('a')).ok).toBe(true);
  });
});
