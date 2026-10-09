import type { McpApi } from '../../shared/ipc';
import type { ApiDeps } from './deps';
import { fail, run } from './errors';

/** Settings for the MCP server; answers a plain error where the app has no server (tests, headless) */
export function createMcpApi(deps: ApiDeps): McpApi {
  const controller = () => {
    if (!deps.mcp) throw fail('UNKNOWN', 'MCP is not available in this build.');
    return deps.mcp;
  };
  return {
    mcpStatus: () => run(async () => controller().status()),
    mcpConfigure: (c) => run(() => controller().configure(c)),
    mcpRegenerateToken: () => run(() => controller().regenerateToken()),
  };
}
