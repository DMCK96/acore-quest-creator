import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiError, Result } from '../../shared/ipc';
import { TOOL_VERSION } from '../../core/version';
import type { PromptDef } from './prompts';
import type { McpContext, ToolDef } from './tool';
import { createWriteGuard, type WriteGuard } from './write-guard';

/** The longest answer sent to a client; a longer one is refused so one call cannot flood the model. */
export const MAX_ANSWER_CHARS = 200_000;

const textResult = (value: unknown, isError: boolean) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError });
const NOT_CONNECTED_HINT = ' Call list_profiles, then connect with a profile id, first.';
const failure = (error: ApiError) => textResult(error.code === 'NOT_CONNECTED' ? { ...error, message: error.message + NOT_CONNECTED_HINT } : error, true);

/** Builds the MCP server for a tool list. A tool is data; adding one is adding an entry to the list. */
export function createMcpServer(
  ctx: McpContext,
  tools: readonly ToolDef[],
  runTool: WriteGuard = createWriteGuard(),
  prompts: readonly PromptDef[] = [],
): McpServer {
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
      if (length > MAX_ANSWER_CHARS && tool.write !== false) {
        // The change is made and in History; only the answer is too big to hand over
        return textResult({ done: true, note: `Done. The answer is too large to send (${length} characters), so it is left out; check History or the export folder for the result.` }, false);
      }
      if (length > MAX_ANSWER_CHARS) {
        return failure({ code: 'BAD_REQUEST', message: `The answer is too large to send (${length} characters). Narrow the request: a smaller area, fewer ids or a shorter list.` });
      }
      const picture = tool.image?.(result.value) ?? null;
      if (picture) return { content: [...answer.content, { type: 'image' as const, data: picture.data, mimeType: picture.mimeType }], isError: false };
      return answer;
    });
  }
  // A server with no prompts does not advertise the capability
  for (const prompt of prompts) {
    server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description, argsSchema: prompt.args }, ((args: Record<string, unknown>) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt.text(args) } }],
    })) as never);
  }
  return server;
}
