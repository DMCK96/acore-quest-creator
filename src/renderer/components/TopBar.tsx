import type { ClientStatus, ServerDataStatus } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import './TopBar.css';

/**
 * The persistent header above the canvas: project name, quest/canvas actions, and connection
 * status. Shown for both the `pick` and `edit` screens (the editor opens as a drawer beside the
 * canvas, so this bar never unmounts between them).
 */
export function TopBar({
  store,
  onNewQuest,
  onAddExisting,
  onFitView,
  onOpenProject,
  onOpenSettings,
}: {
  store: AppStore;
  onNewQuest: () => void;
  onAddExisting: () => void;
  onFitView: () => void;
  onOpenProject: () => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const projectName = store((s) => s.project.name);
  const dirty = store((s) => s.project.dirty);
  const summary = store((s) => s.summary);
  const profiles = store((s) => s.profiles);

  const connectedDatabase = summary ? profiles.find((p) => p.id === summary.profileId)?.database : undefined;

  return (
    <header className="topbar">
      <div className="topbar__identity">
        <span className="topbar__label">Project</span>
        <div className="topbar__name">
          <h1 className="topbar__title">{projectName.trim() === '' ? 'Untitled Project' : projectName}</h1>
          {/* Outside the heading, so the heading's name stays the project name alone. */}
          {dirty && (
            <span className="topbar__dirty" aria-label="Unsaved changes" title="Unsaved changes">
              •
            </span>
          )}
          <button type="button" className="btn topbar__project" aria-label="Project" onClick={onOpenProject}>
            <span aria-hidden="true">📁</span> Project
          </button>
        </div>
      </div>
      <div className="topbar__actions">
        <button type="button" className="btn" onClick={onNewQuest}>
          New quest
        </button>
        <button type="button" className="btn" onClick={onAddExisting}>
          Add existing quest
        </button>
        <button type="button" className="btn" onClick={onFitView}>
          Fit view
        </button>
        <span
          className={`status-pill${connectedDatabase ? ' status-pill--connected' : ''}`}
          role="status"
        >
          <span className="status-pill__dot" />
          {connectedDatabase ? `Connected: ${connectedDatabase}` : 'Not connected'}
        </span>
        {connectedDatabase && summary?.serverData && <ServerDataPill status={summary.serverData} />}
        {connectedDatabase && summary?.client && <ClientPill status={summary.client} />}
        <button type="button" className="btn btn--icon" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          ⚙
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
