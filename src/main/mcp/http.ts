import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface McpHttpOptions {
  /** 0 picks a free port. */
  port: number;
  /** Read on every request, so a regenerated token takes effect at once. */
  token: () => string;
  /** A new server for each request: the transport is stateless. */
  createServer: () => McpServer;
}

export interface McpHttp {
  /** The port actually listening. */
  port: number;
  address: string;
  close(): Promise<void>;
}

/** The host part of a `Host` header value (`localhost:47600` → `localhost`, `[::1]:80` → `[::1]`). */
const hostOf = (value: string): string => (value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : (value.split(':')[0] ?? ''));

const sameToken = (given: string | undefined, expected: string): boolean => {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
};

const refuse = (res: http.ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify({ error: message }));
};

async function readJson(req: http.IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false; tooLarge?: true }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
    chunks.push(chunk as Buffer);
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false };
  }
}

/**
 * The MCP server on `127.0.0.1`, for clients that hold the token. Only `POST /mcp` is served. A web
 * page in the user's browser can reach localhost too, so a request whose `Host` or `Origin` is not
 * loopback is refused before the token is looked at.
 */
export function startMcpHttp(options: McpHttpOptions): Promise<McpHttp> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const host = req.headers.host;
      if (host === undefined || !LOOPBACK_HOSTS.has(hostOf(host))) return refuse(res, 403, 'Forbidden host.');
      const origin = req.headers.origin;
      if (origin !== undefined) {
        let originHost = '';
        try {
          originHost = new URL(origin).hostname;
        } catch {
          // an unparsable origin stays refused below
        }
        if (!LOOPBACK_HOSTS.has(originHost) && !LOOPBACK_HOSTS.has(`[${originHost}]`)) return refuse(res, 403, 'Forbidden origin.');
      }
      if (!sameToken(req.headers.authorization, options.token())) return refuse(res, 401, 'Missing or wrong token.', { 'www-authenticate': 'Bearer' });
      if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') return refuse(res, 404, 'Not found.');
      if (req.method !== 'POST') return refuse(res, 405, 'Use POST.', { allow: 'POST' });

      const parsed = await readJson(req);
      if (!parsed.ok && parsed.tooLarge) {
        // Stop reading what was sent: answer, then drop the connection
        res.on('finish', () => req.destroy());
        return refuse(res, 413, 'The body is too large.', { connection: 'close' });
      }
      if (!parsed.ok) return refuse(res, 400, 'The body must be JSON.');

      const mcp = options.createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsed.body);
    })().catch((error: unknown) => {
      console.error('MCP request failed:', error);
      if (!res.headersSent) refuse(res, 500, 'Internal error.');
      else res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'EADDRINUSE' ? new Error(`Port ${options.port} is already in use.`) : error);
    });
    server.listen(options.port, '127.0.0.1', () => {
      const bound = server.address() as AddressInfo;
      resolve({
        port: bound.port,
        address: bound.address,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
