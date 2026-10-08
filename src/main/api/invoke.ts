import { parseRequest, type Api, type ApiError, type Result } from '../../shared/ipc';

/** An exception that escaped the API (a bug) becomes an ordinary `Result`, so nothing ever rejects. */
export const unknownError = (error: unknown): { ok: false; error: ApiError } => ({
  ok: false,
  error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) },
});

/**
 * One call into the API from outside it (the IPC bridge, the MCP server): arguments are validated
 * before the API sees them and nothing is ever allowed to reject.
 */
export async function invokeApi(api: Api, method: keyof Api, args: unknown[]): Promise<Result<unknown>> {
  const parsed = parseRequest(method, args);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    const call = api[method] as (...a: unknown[]) => Promise<Result<unknown>>;
    return await call.apply(api, parsed.args);
  } catch (error) {
    return unknownError(error);
  }
}
