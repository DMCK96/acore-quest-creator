import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiError, Result } from '../../shared/ipc';
import { TOOL_VERSION } from '../../core/version';
import type { McpContext, ToolDef } from './tool';
import { createWriteGuard, type WriteGuard } from './write-guard';

/** The longest answer sent to a client; a longer one is refused so one call cannot flood the model. */
export const MAX_ANSWER_CHARS = 200_000;

const textResult = (value: unknown, isError: boolean) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError });
const failure = (error: ApiError) => textResult(error, true);

/** Builds the MCP server for a tool list. A tool is data; adding one is adding an entry to the list. */
export function createMcpServer(ctx: McpContext, tools: readonly ToolDef[], runTool: WriteGuard = createWriteGuard()): McpServer {
  const server = new McpServer({ name: 'azeroth-world-editor', version: TOOL_VERSION });
  for (const tool of tools) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.input }, async (args: z.infer<z.ZodObject<any>>) => {
      let result: Result<unknown>;
      try {
        result = await runTool(ctx, tool, args);
      } catch (error) {
        result = { ok: false, error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } };
      }
      if (!result.ok) return failure(result.error);
      const shown = tool.present ? tool.present(result.value) : result.value;
      const answer = textResult(shown, false);
      const length = answer.content[0]!.text.length;
      if (length > MAX_ANSWER_CHARS) {
        return failure({ code: 'BAD_REQUEST', message: `The answer is too large to send (${length} characters). Narrow the request: a smaller area, fewer ids or a shorter list.` });
      }
      return answer;
    });
  }
  return server;
}
