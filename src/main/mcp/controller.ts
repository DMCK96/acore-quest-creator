import type { McpStatus } from '../../shared/ipc';
import type { McpSettings } from './settings';

export interface McpListener {
  port: number;
  close(): Promise<void>;
}

export interface McpControllerOptions {
  settings: McpSettings;
  /** Starts listening; rejects when it cannot (the port is in use). */
  listen(o: { port: number; token: () => string }): Promise<McpListener>;
}

export interface McpController {
  status(): McpStatus;
  /** Starts the server if it was left enabled; for the app's launch. */
  start(): Promise<McpStatus>;
  configure(c: { enabled: boolean; port: number }): Promise<McpStatus>;
  regenerateToken(): Promise<McpStatus>;
  stop(): Promise<void>;
}

/** Owns the running MCP server: starts it, stops it, restarts it when the settings change. */
export function createMcpController({ settings, listen }: McpControllerOptions): McpController {
  let listener: McpListener | null = null;
  let error: string | null = null;

  const status = (): McpStatus => {
    const s = settings.read();
    return { enabled: s.enabled, port: s.port, url: `http://127.0.0.1:${s.port}/mcp`, token: s.token, running: listener !== null, error };
  };
  const stop = async (): Promise<void> => {
    const old = listener;
    listener = null;
    await old?.close();
  };
  const begin = async (): Promise<McpStatus> => {
    await stop();
    error = null;
    const s = settings.read();
    if (s.enabled) {
      try {
        listener = await listen({ port: s.port, token: () => settings.read().token });
      } catch (e) {
        settings.setEnabled(false);
        error = e instanceof Error ? e.message : String(e);
      }
    }
    return status();
  };

  return {
    status,
    start: begin,
    async configure({ enabled, port }) {
      settings.setPort(port);
      settings.setEnabled(enabled);
      return begin();
    },
    async regenerateToken() {
      settings.regenerateToken();
      return status();
    },
    stop,
  };
}
