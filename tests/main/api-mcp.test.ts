import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { createMcpSettings } from '../../src/main/mcp/settings';
import { createMcpController } from '../../src/main/mcp/controller';
import { parseRequest } from '../../src/shared/ipc';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const deps = (store = openStore(':memory:', box), mcp?: any) => ({
  store, openWorldDb: async () => { throw new Error('x'); }, openDevDb: async () => { throw new Error('x'); },
  fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
  session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController, mcp,
});

describe('the MCP settings API', () => {
  it('reports, configures and regenerates through the controller', async () => {
    const store = openStore(':memory:', box);
    const controller = createMcpController({ settings: createMcpSettings(store), listen: async (o) => ({ port: o.port, close: async () => {} }) });
    const api = createApi(deps(store, controller));
    const status: any = await api.mcpStatus();
    expect(status.value.enabled).toBe(false);
    const on: any = await api.mcpConfigure({ enabled: true, port: 50000 });
    expect(on.value.running).toBe(true);
    const fresh: any = await api.mcpRegenerateToken();
    expect(fresh.value.token).not.toBe(on.value.token);
  });

  it('answers a plain error when the app has no MCP controller', async () => {
    const api = createApi(deps());
    const out: any = await api.mcpStatus();
    expect(out.ok).toBe(false);
  });

  it('refuses a port below 1024 or above 65535', () => {
    expect(parseRequest('mcpConfigure', [{ enabled: true, port: 80 }]).ok).toBe(false);
    expect(parseRequest('mcpConfigure', [{ enabled: true, port: 70000 }]).ok).toBe(false);
    expect(parseRequest('mcpConfigure', [{ enabled: true, port: 47600 }]).ok).toBe(true);
  });
});
