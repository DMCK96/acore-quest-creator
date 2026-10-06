import type { ProjectApi, ProjectState } from '../../shared/ipc';
import type { Services } from './services';
import { run } from './errors';

/** The project file: new, open, save, rename, recent projects and recovery */
export function createProjectApi(s: Services): ProjectApi {
  const { deps } = s.ctx;

  return {
    projectState: () => run(async (): Promise<ProjectState> => deps.projects.state()),

    renameProject: (name) =>
      run(async () => {
        deps.projects.rename(name);
        return true as const;
      }),

    newProject: (name) => run(() => deps.projects.newProject(name)),

    openProject: (path) => run(() => deps.projects.open(path)),

    saveProject: () => run(() => deps.projects.save()),

    saveProjectAs: () => run(() => deps.projects.saveAs()),

    recentProjects: () => run(() => deps.projects.recent()),

    forgetRecent: (path) =>
      run(async () => {
        deps.projects.forgetRecent(path);
        return true as const;
      }),

    recoveries: () => run(() => deps.projects.recoveries()),

    restoreRecovery: (id) =>
      run(async () => {
        await deps.projects.restoreRecovery(id);
        return true as const;
      }),

    discardRecovery: (id) =>
      run(async () => {
        await deps.projects.discardRecovery(id);
        return true as const;
      }),
  };
}
