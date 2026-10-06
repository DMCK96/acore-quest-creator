import type { Difference } from '@core/roundtrip/compare';
import type { Issue } from '@core/validate/validate';

export type ErrorCode =
  | 'NOT_CONNECTED'
  | 'INVALID_QUEST_ID'
  | 'QUEST_NOT_FOUND'
  | 'FIDELITY'
  | 'VALIDATION'
  | 'ID_COLLISION'
  | 'RANGE_EXHAUSTED'
  | 'CONNECTION'
  /** The connection is fine; the database user lacks a grant the tool needs. */
  | 'PERMISSION'
  /** The server refused a query for a reason that is neither the connection nor a grant. */
  | 'QUERY'
  | 'NO_DEV_PROFILE'
  | 'CONFIRMATION_REQUIRED'
  | 'BAD_REQUEST'
  | 'BLOCKING_DRIFT'
  /** A project or recovery file could not be read, or is not a project this tool can open. */
  | 'PROJECT_FILE'
  /** Writing the project file failed; the work is still open and unsaved. */
  | 'SAVE_FAILED'
  | 'INVALID_NAME'
  | 'UNKNOWN';

export interface ApiError {
  code: ErrorCode;
  message: string;
  /** Present on `VALIDATION`: what the user has to fix before the quest can be exported. */
  issues?: Issue[];
  /** Present on `FIDELITY`: the cells an unedited export would not reproduce. */
  differences?: Difference[];
}

/** Every call answers with one of these: the API never rejects for a fault the user can act on. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };
