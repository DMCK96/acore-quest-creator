import type { ApiDeps } from './deps';
import { createChecks, type Checks } from './checks';
import { createConnection } from './connection';
import { createContext, type ApiContext } from './context';
import { createPatches, type Patches } from './patches';
import { createServerFiles, type ServerFiles } from './server-files';
import { createSpawnGroups, type SpawnGroups } from './spawn-groups';
import { createTravel, type Travel } from './travel';

/** The parts every area of the API is built from, made once per API */
export interface Services {
  ctx: ApiContext;
  files: ServerFiles;
  checks: Checks;
  patches: Patches;
  groups: SpawnGroups;
  travel: Travel;
}

export function createServices(deps: ApiDeps): Services {
  const ctx = createContext(deps, createConnection(deps));
  const files = createServerFiles(deps);

  return {
    ctx,
    files,
    checks: createChecks(ctx, files),
    patches: createPatches(ctx),
    groups: createSpawnGroups(ctx),
    travel: createTravel(ctx),
  };
}
