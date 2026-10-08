import type { Result } from './result';

/** The MCP server as Settings shows it. */
export interface McpStatus {
  enabled: boolean;
  port: number;
  /** Where an MCP client connects. */
  url: string;
  /** What a client sends as `Authorization: Bearer <token>`. */
  token: string;
  /** The server is listening now (it is off after a port clash even if it was asked for). */
  running: boolean;
  /** Why the server could not start, or null. */
  error: string | null;
}

/** Letting an AI client (an MCP client) work in the open project: on or off, the port, the token */
export interface McpApi {
  mcpStatus(): Promise<Result<McpStatus>>;
  /** Turns the server on or off and sets its port; a port that cannot be used leaves it off and says why in `error`. */
  mcpConfigure(c: { enabled: boolean; port: number }): Promise<Result<McpStatus>>;
  /** Makes a new token; the old one stops working at once. */
  mcpRegenerateToken(): Promise<Result<McpStatus>>;
}
