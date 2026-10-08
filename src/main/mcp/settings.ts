import { randomBytes } from 'node:crypto';
import type { Store } from '../store/store';

export const DEFAULT_MCP_PORT = 47600;
export const MIN_MCP_PORT = 1024;
export const MAX_MCP_PORT = 65535;

const ENABLED = 'mcp.enabled';
const PORT = 'mcp.port';
const TOKEN = 'mcp.token';

export interface McpSettingsValues {
  enabled: boolean;
  port: number;
  token: string;
}

/**
 * Whether the MCP server runs, on which port, and the token a client must present. Off by default.
 * The token is made on first use and kept sealed in the store; it never leaves the machine except
 * through the Settings tab.
 */
export function createMcpSettings(store: Store, random: (bytes: number) => Buffer = randomBytes) {
  const newToken = (): string => random(32).toString('base64url');
  return {
    read(): McpSettingsValues {
      let token = store.settings.getSecret(TOKEN);
      if (token === null) {
        token = newToken();
        store.settings.setSecret(TOKEN, token);
      }
      const port = Number(store.settings.get(PORT));
      return { enabled: store.settings.get(ENABLED) === '1', port: Number.isInteger(port) && port >= MIN_MCP_PORT ? port : DEFAULT_MCP_PORT, token };
    },
    setEnabled(on: boolean): void {
      store.settings.set(ENABLED, on ? '1' : '0');
    },
    setPort(port: number): void {
      if (!Number.isInteger(port) || port < MIN_MCP_PORT || port > MAX_MCP_PORT) {
        throw new RangeError(`The port must be a whole number from ${MIN_MCP_PORT} to ${MAX_MCP_PORT}.`);
      }
      store.settings.set(PORT, String(port));
    },
    regenerateToken(): string {
      const token = newToken();
      store.settings.setSecret(TOKEN, token);
      return token;
    },
  };
}

export type McpSettings = ReturnType<typeof createMcpSettings>;
