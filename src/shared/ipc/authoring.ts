import type { Issue } from '@core/validate/validate';
import type { Result } from './result';

/** Checks on what the assistant (or the author) has written for the project's own NPCs, objects and items */
export interface AuthoringApi {
  /** What the editor finds wrong with the project's new NPCs, objects and items, each issue naming the one it is about. */
  projectIssues(): Promise<Result<Issue[]>>;
}
