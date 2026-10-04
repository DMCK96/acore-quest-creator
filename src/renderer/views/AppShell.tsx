import { useEffect, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { AppBar, type Workspace } from '../components/AppBar';
import { ErrorBanner } from '../components/ErrorBanner';
import { CanvasHome } from './CanvasHome';
import { WorldWorkspace } from '../world3d/WorldWorkspace';
import { projectKey } from '../world3d/welcome-seen';
import { ProjectDialog } from './ProjectDialog';
import { SettingsDialog } from './SettingsDialog';
import { RecoveryDialog } from './RecoveryDialog';
import './AppShell.css';

/**
 * The app once connected: the app bar over two workspaces, the world in 3D (where it opens) and the
 * quest graph. Both stay mounted, so switching keeps the camera and the graph where they were; the
 * world stops drawing while the quests show.
 */
export function AppShell({ store }: { store: AppStore }): React.JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace>('world');
  const [showProject, setShowProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const screen = store((s) => s.screen);
  const filePath = store((s) => s.project.filePath);
  const projectName = store((s) => s.project.name);
  const hasClient = store((s) => Boolean(s.summary?.clientDir));

  // A quest opened from anywhere is previewed on the graph, so the quests come forward
  useEffect(() => {
    if (screen === 'preview' || screen === 'edit') setWorkspace('quests');
  }, [screen]);

  // Unsaved work a crash left behind is offered once, as soon as the app is up.
  useEffect(() => {
    void store.getState().loadRecoveries();
  }, [store]);

  // Ctrl+S saves, Ctrl+Shift+S saves as, Ctrl+O opens: the shortcuts every document app has.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // A held-down shortcut repeats; one press is one save.
      if (!(e.ctrlKey || e.metaKey) || e.repeat) return;
      const key = e.key.toLowerCase();
      const { saveProject, saveProjectAs, openProject } = store.getState();
      if (key === 's') {
        e.preventDefault();
        void (e.shiftKey ? saveProjectAs() : saveProject());
      } else if (key === 'o') {
        e.preventDefault();
        void openProject();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);

  return (
    <div className="app-shell">
      <AppBar
        store={store}
        workspace={workspace}
        onWorkspace={setWorkspace}
        onOpenProject={() => setShowProject(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <ErrorBanner store={store} />
      <div className="app-shell__workspace" hidden={workspace !== 'world'}>
        <WorldWorkspace
          hasClient={hasClient}
          active={workspace === 'world'}
          projectKey={projectKey(filePath)}
          // A project not saved yet is welcomed without its placeholder name
          projectName={filePath ? projectName : ''}
          onOpenSettings={() => setShowSettings(true)}
          onShowQuests={() => setWorkspace('quests')}
          onStartQuest={() => {
            setWorkspace('quests');
            void store.getState().newQuest();
          }}
        />
      </div>
      <div className="app-shell__workspace" hidden={workspace !== 'quests'}>
        <CanvasHome store={store} />
      </div>
      {showProject && <ProjectDialog store={store} onClose={() => setShowProject(false)} />}
      {showSettings && <SettingsDialog store={store} onClose={() => setShowSettings(false)} />}
      <RecoveryDialog store={store} />
    </div>
  );
}
