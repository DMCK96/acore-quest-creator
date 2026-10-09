import type { AuthoringApi } from '../../shared/ipc';
import type { Services } from './services';
import { run } from './errors';

/** Checks on the project's own NPCs, objects and items */
export function createAuthoringApi(s: Services): AuthoringApi {
  const { connected, projectEntities } = s.ctx;
  return {
    projectIssues: () => run(async () => s.checks.newEntityIssues(connected(), projectEntities())),
  };
}
