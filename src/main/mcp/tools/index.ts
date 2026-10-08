import type { ToolDef } from '../tool';
import { lookupTools } from './lookup';
import { projectTools } from './project';
import { questTools } from './quests';
import { entityTools } from './entities';
import { worldTools } from './world';

/**
 * Every tool the MCP server offers. A tool reaches the app only through `ctx.call`, never `ctx.api`,
 * so its arguments are validated like the window's (tests/main/mcp-tools-surface.test.ts enforces it).
 */
export const allTools: readonly ToolDef[] = [...projectTools, ...lookupTools, ...questTools, ...entityTools, ...worldTools];
