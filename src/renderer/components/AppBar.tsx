import { useRef } from 'react';
import type { ClientStatus, ServerDataStatus } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import { OrbMark } from './OrbMark';
import { HistoryButtons } from './HistoryButtons';
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
          <span className="app-bar__project-label">Project</span>
        </button>
      </div>
      {/* The middle column: the workspace switch, with undo and redo beside it */}
      <div className="app-bar__center">
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
        <HistoryButtons store={store} />
      </div>
      <div className="app-bar__status">
        <span
          className={`status-pill${connectedDatabase ? ' status-pill--connected' : ''}`}
          role="status"
          title={connectedDatabase ? `Connected: ${connectedDatabase}` : 'Not connected'}
        >
          <span className="status-pill__dot" />
          <span className="status-pill__label">{connectedDatabase ? `Connected: ${connectedDatabase}` : 'Not connected'}</span>
        </span>
        {connectedDatabase && summary?.serverData && <ServerDataPill status={summary.serverData} />}
        {connectedDatabase && summary?.client && <ClientPill status={summary.client} />}
        <button type="button" className="btn btn--icon" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          <svg className="app-bar__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13.08 6.17L14.84 6.50L14.84 9.50L13.08 9.83L12.89 10.30L13.90 11.77L11.77 13.90L10.30 12.89L9.83 13.08L9.50 14.84L6.50 14.84L6.17 13.08L5.70 12.89L4.23 13.90L2.10 11.77L3.11 10.30L2.92 9.83L1.16 9.50L1.16 6.50L2.92 6.17L3.11 5.70L2.10 4.23L4.23 2.10L5.70 3.11L6.17 2.92L6.50 1.16L9.50 1.16L9.83 2.92L10.30 3.11L11.77 2.10L13.90 4.23L12.89 5.70Z" />
            <circle cx="8" cy="8" r="2.3" />
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
      <span className="status-pill__label">{label}</span>
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
      <span className="status-pill__label">{label}</span>
    </span>
  );
}
