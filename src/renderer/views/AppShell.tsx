import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectEntitiesFromStore } from '../state/project-entities';
import type { AppStore } from '../state/app-store';
import { AppBar, type Workspace } from '../components/AppBar';
import { ErrorBanner } from '../components/ErrorBanner';
import { HistoryNote } from '../components/HistoryNote';
import { isTextField } from '../components/HistoryButtons';
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
  const questsAsked = store((s) => s.questsAsked);
  const filePath = store((s) => s.project.filePath);
  const projectName = store((s) => s.project.name);
  const hasClient = store((s) => Boolean(s.summary?.clientDir));
  const open = store((s) => s.open);
  const nodes = store((s) => s.nodes);
  const [goTo, setGoTo] = useState<{ map: number; x: number; y: number; z: number; nonce: number } | undefined>();

  // When the author last picked a workspace, on the store's clock
  const chosenAt = useRef(0);
  const choose = useCallback(
    (next: Workspace) => {
      chosenAt.current = store.getState().moment();
      setWorkspace(next);
    },
    [store],
  );

  // A quest opened from anywhere is previewed on the graph, so the quests come forward; but not for an
  // open the author has since turned away from, by picking a workspace while it was on its way
  useEffect(() => {
    if (questsAsked > chosenAt.current) setWorkspace('quests');
  }, [questsAsked]);

  // Unsaved work a crash left behind is offered once, as soon as the app is up.
  useEffect(() => {
    void store.getState().loadRecoveries();
  }, [store]);

  // Ctrl+S saves, Ctrl+Shift+S saves as, Ctrl+O opens: the shortcuts every document app has. Ctrl+Z
  // and Ctrl+Y undo and redo the last change anywhere in the project, except in a text field, whose
  // own undo they are.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const { saveProject, saveProjectAs, openProject, undo, redo } = store.getState();
      // By the key's place as well as its letter, so a keyboard whose letters are not Latin still undoes
      const z = key === 'z' || e.code === 'KeyZ';
      const y = key === 'y' || e.code === 'KeyY';
      if ((z || y) && !e.altKey) {
        if (isTextField(e.target) || e.defaultPrevented) return;
        e.preventDefault();
        // Held down, it walks back step by step
        void (y || e.shiftKey ? redo() : undo());
        return;
      }
      // A held-down shortcut repeats; one press is one save.
      if (e.repeat) return;
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
    <ProjectEntitiesFromStore store={store}>
    <div className="app-shell">
      <AppBar
        store={store}
        workspace={workspace}
        onWorkspace={choose}
        onOpenProject={() => setShowProject(true)}
        onOpenSettings={() => setShowSettings(true)}
      />
      <ErrorBanner store={store} />
      <HistoryNote
        store={store}
        onShowQuest={(questId) => {
          choose('quests');
          void store.getState().openQuest(questId);
        }}
        onShowPlace={(place) => {
          choose('world');
          setGoTo((was) => ({ map: place.map, x: place.x, y: place.y, z: place.z, nonce: (was?.nonce ?? 0) + 1 }));
        }}
      />
      <div className="app-shell__workspace" hidden={workspace !== 'world'}>
        <WorldWorkspace
          hasClient={hasClient}
          active={workspace === 'world'}
          projectKey={projectKey(filePath)}
          // A project not saved yet is welcomed without its placeholder name
          projectName={filePath ? projectName : ''}
          onOpenSettings={() => setShowSettings(true)}
          onShowQuests={() => choose('quests')}
          onStartQuest={() => {
            choose('quests');
            void store.getState().newQuest();
          }}
          quest={open ? { open, nodes } : undefined}
          goTo={goTo}
          onQuestField={(fieldId, value) => store.getState().setValue(fieldId, value)}
          onNewQuest={(giver, previous) => {
            // The NPC gives the new quest and takes it back; in a chain, it comes after the one that was
            // open. The quest it makes brings the quests forward, so one that cannot be made leaves the world.
            void store.getState().newQuestFrom(giver, previous);
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
    </ProjectEntitiesFromStore>
  );
}
