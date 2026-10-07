import type { ClientStatus, ServerDataStatus } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import { OrbMark } from './OrbMark';
import { HistoryButtons } from './HistoryButtons';
import './AppBar.css';

/**
 * The bar across the top of the app, on the login card's frosted surface: the orb and the project,
 * the Quests dock's toggle, what is connected, and Settings.
 */
export function AppBar({
  store,
  dockOpen,
  onToggleDock,
  onOpenProject,
  onOpenSettings,
}: {
  store: AppStore;
  /** Whether the quest chain's dock shows under or beside the world */
  dockOpen: boolean;
  onToggleDock(): void;
  onOpenProject(): void;
  onOpenSettings(): void;
}): React.JSX.Element {
  const projectName = store((s) => s.project.name);
  const dirty = store((s) => s.project.dirty);
  const summary = store((s) => s.summary);
  const profiles = store((s) => s.profiles);

  const connectedDatabase = summary ? profiles.find((p) => p.id === summary.profileId)?.database : undefined;

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
      {/* The middle column: the Quests dock's toggle, with undo and redo beside it */}
      <div className="app-bar__center">
        <button type="button" className="btn app-bar__quests" aria-pressed={dockOpen} onClick={onToggleDock}>
          <svg className="app-bar__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 2.5h7a1 1 0 0 1 1 1v10l-4.5-2.5-4.5 2.5v-10a1 1 0 0 1 1-1z" />
            <path d="M6 6h4M6 8.5h4" />
          </svg>
          <span className="app-bar__quests-label">Quests</span>
        </button>
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
