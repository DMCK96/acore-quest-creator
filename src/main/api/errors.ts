import type { ApiError, ErrorCode, Result } from '../../shared/ipc';

/** An error the user can act on, already carrying the code the renderer switches on. */
export class ApiFailure extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
    this.name = 'ApiFailure';
  }
}

export const fail = (code: ErrorCode, message: string, extra: Omit<ApiError, 'code' | 'message'> = {}): ApiFailure =>
  new ApiFailure({ code, message, ...extra });

/** Named core errors become codes; anything else is a bug, reported as `UNKNOWN` with its message. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiFailure) return error.error;
  const message = error instanceof Error ? error.message : String(error);
  const byName: Partial<Record<string, ErrorCode>> = {
    InvalidQuestIdError: 'INVALID_QUEST_ID',
    QuestNotFoundError: 'QUEST_NOT_FOUND',
    RangeExhaustedError: 'RANGE_EXHAUSTED',
    IdCollisionError: 'ID_COLLISION',
    InvalidRangeError: 'BAD_REQUEST',
    ProjectFileError: 'PROJECT_FILE',
    SaveFailedError: 'SAVE_FAILED',
    InvalidNameError: 'INVALID_NAME',
    WorldDbConnectionError: 'CONNECTION',
    // A missing grant is not a connection failure, and the message must not send the user to
    // check their host and port for a problem that lives in their GRANT statements.
    WorldDbPermissionError: 'PERMISSION',
    WorldDbQueryError: 'QUERY',
  };
  const code = error instanceof Error ? byName[error.name] : undefined;

  return { code: code ?? 'UNKNOWN', message };
}

/** Runs a call, turning what it throws into the error the renderer is sent */
export async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: toApiError(error) };
  }
}
