import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { forkDb } from '../helpers/fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

async function connectWith(clientDir: string | undefined) {
  const onClientDir = vi.fn();
  const api = createApi({
    store: openStore(':memory:', box), openWorldDb: async () => forkDb(), openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
    session: createProjectSession(defaultProjectMeta('P', 'C:\\out')), projects: {} as ProjectController, onClientDir,
  });
  const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p', ...(clientDir === undefined ? {} : { clientDir }) });
  const summary: any = await api.connect(rec.value.id);
  return { onClientDir, summary: summary.value };
}

describe('game client folder', () => {
  it("passes the profile's client folder on when connecting and reports it", async () => {
    const { onClientDir, summary } = await connectWith(' E:/Games/WoW ');
    expect(onClientDir).toHaveBeenCalledWith('E:/Games/WoW');
    expect(summary.clientDir).toBe('E:/Games/WoW');
  });
  it('reports no client folder when the profile names none', async () => {
    const { onClientDir, summary } = await connectWith(undefined);
    expect(onClientDir).toHaveBeenCalledWith(null);
    expect(summary.clientDir).toBeNull();
  });
});
