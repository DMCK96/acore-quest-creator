import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApi } from '../../src/main/api';
import { invokeApi } from '../../src/main/api/invoke';
import { createMcpServer } from '../../src/main/mcp/server';
import type { McpContext, ToolDef } from '../../src/main/mcp/tool';
import type { ProjectController } from '../../src/main/project/controller';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import { createProjectSession } from '../../src/main/project/session';
import { openStore } from '../../src/main/store/store';
import type { HistoryResult } from '../../src/shared/history';
import { forkDb } from './fixtures';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };

export interface McpFixtureOptions {
  /** Connect the API to the world database (default true). */
  connect?: boolean;
  flushTimeoutMs?: number;
  flush?: () => Promise<void>;
}

/**
 * The real API over an in-memory world (Stormwind Guard 1423 with one spawn, 80330), an in-memory
 * store and a fake file system, with the MCP server on one end of an in-memory transport and an SDK
 * client on the other.
 */
export async function mcpFixture(tools: readonly ToolDef[], opts: McpFixtureOptions = {}) {
  const db = forkDb();
  db.insert('creature_template', { entry: '1423', name: 'Stormwind Guard' });
  db.insert('creature', { guid: '80330', id1: '1423', map: '0', position_x: '-9481.31', position_y: '74.42', position_z: '56.55', orientation: '1.5' });
  const session = createProjectSession(defaultProjectMeta('P', 'C:\out'));
  const api = createApi({
    store: openStore(':memory:', box),
    openWorldDb: async () => db,
    openDevDb: async () => { throw new Error('no dev database in tests'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] },
    now: () => new Date('2026-10-08T12:00:00Z'),
    session,
    projects: {} as ProjectController,
  });
  if (opts.connect !== false) {
    const rec: any = await api.saveProfile({ name: 'w', role: 'world', host: 'h', port: 1, user: 'u', database: 'd', password: 'p' });
    await api.connect(rec.value.id);
  }

  const changes: HistoryResult[] = [];
  const order: string[] = [];
  const ctx: McpContext = {
    api,
    session,
    call: ((method: any, ...args: any[]) => invokeApi(api, method, args)) as McpContext['call'],
    flush: async () => {
      order.push('flush');
      await opts.flush?.();
    },
    notify: (change) => { order.push('notify'); changes.push(change); },
    ...(opts.flushTimeoutMs !== undefined ? { flushTimeoutMs: opts.flushTimeoutMs } : {}),
  };
  const server = createMcpServer(ctx, tools);
  const client = new Client({ name: 'test', version: '1' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; value: any }> => {
    let text = '';
    let isError = false;
    try {
      const r: any = await client.callTool({ name, arguments: args });
      isError = !!r.isError;
      text = r.content?.[0]?.text ?? '';
    } catch (error) {
      isError = true;
      text = error instanceof Error ? error.message : String(error);
    }
    try {
      return { isError, value: JSON.parse(text) };
    } catch {
      return { isError, value: { message: text } };
    }
  };

  return { api, db, session, client, call, changes, order, ctx };
}
