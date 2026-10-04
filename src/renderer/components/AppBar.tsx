import { useRef } from 'react';
import type { ClientStatus, ServerDataStatus } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import { OrbMark } from './OrbMark';
import './AppBar.css';

/** The app's two workspaces: the world in 3D, and the quest graph */
export type Workspace = 'world' | 'quests';

const WORKSPACES: [Workspace, string][] = [
  ['world', 'World'],
  ['quests', 'Quests'],
];

/**
 * The bar across the top of the app, on the login card's frosted surface: the orb and the project,
 * the World and Quests tabs, what is connected, and Settings.
 */
export function AppBar({
  store,
  workspace,
  onWorkspace,
  onOpenProject,
  onOpenSettings,
}: {
  store: AppStore;
  workspace: Workspace;
  onWorkspace(workspace: Workspace): void;
  onOpenProject(): void;
  onOpenSettings(): void;
}): React.JSX.Element {
  const projectName = store((s) => s.project.name);
  const dirty = store((s) => s.project.dirty);
  const summary = store((s) => s.summary);
  const profiles = store((s) => s.profiles);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const connectedDatabase = summary ? profiles.find((p) => p.id === summary.profileId)?.database : undefined;

  /** Left and right move between the tabs (and choose the one moved to), as tabs do */
  const onTabKey = (e: React.KeyboardEvent, index: number): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : WORKSPACES.length - 1)) % WORKSPACES.length;
    onWorkspace(WORKSPACES[next]![0]);
    tabs.current[next]?.focus();
  };

  return (
    <header className="app-bar">
      <div className="app-bar__identity">
        <OrbMark />
        <div className="app-bar__name">
          <h1 className="app-bar__title">{projectName.trim() === '' ? 'Untitled Project' : projectName}</h1>
          {/* Outside the heading, so the heading's name stays the project name alone. */}
          {dirty && (
            <span className="app-bar__dirty" aria-label="Unsaved changes" title="Unsaved changes">
              •
            </span>
          )}
        </div>
        <button type="button" className="btn app-bar__project" aria-label="Project" onClick={onOpenProject}>
          <svg className="app-bar__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6.5a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z" />
          </svg>
          Project
        </button>
      </div>
      <div className="app-bar__tabs" role="tablist" aria-label="Workspace">
        {WORKSPACES.map(([id, label], index) => (
          <button
            key={id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            className="app-bar__tab"
            aria-selected={workspace === id}
            tabIndex={workspace === id ? 0 : -1}
            onClick={() => onWorkspace(id)}
            onKeyDown={(e) => onTabKey(e, index)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="app-bar__status">
        <span className={`status-pill${connectedDatabase ? ' status-pill--connected' : ''}`} role="status">
          <span className="status-pill__dot" />
          {connectedDatabase ? `Connected: ${connectedDatabase}` : 'Not connected'}
        </span>
        {connectedDatabase && summary?.serverData && <ServerDataPill status={summary.serverData} />}
        {connectedDatabase && summary?.client && <ClientPill status={summary.client} />}
        <button type="button" className="btn btn--icon" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          <svg className="app-bar__icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/** The optional server data folder: read cleanly, or what could not be read from it. */
function ServerDataPill({ status }: { status: ServerDataStatus }): React.JSX.Element {
  const problems = status.problems.length;
  const label = problems === 0 ? 'Server data' : `Server data: ${problems} ${problems === 1 ? 'problem' : 'problems'}`;
  const detail = [`Folder: ${status.dir}`, ...status.loaded.map((f) => `Read ${f}`), ...status.problems].join('\n');
  return (
    <span className={`status-pill ${problems === 0 ? 'status-pill--connected' : 'status-pill--warning'}`} title={detail}>
      <span className="status-pill__dot" />
      {label}
    </span>
  );
}

/** The optional game client folder: the archives the map reads, or why it reads none. */
function ClientPill({ status }: { status: ClientStatus }): React.JSX.Element {
  const problems = status.problems.length;
  const label = problems === 0 ? 'Game client' : `Game client: ${problems} ${problems === 1 ? 'problem' : 'problems'}`;
  const read = status.archives.length === 1 ? 'Read 1 archive' : `Read ${status.archives.length} archives`;
  const detail = [`Folder: ${status.dir}`, ...(status.archives.length > 0 ? [read] : []), ...status.problems].join('\n');
  return (
    <span className={`status-pill ${problems === 0 ? 'status-pill--connected' : 'status-pill--warning'}`} title={detail}>
      <span className="status-pill__dot" />
      {label}
    </span>
  );
}
