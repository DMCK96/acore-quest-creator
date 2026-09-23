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
}: {
  store: AppStore;
  onNewQuest: () => void;
  onAddExisting: () => void;
  onFitView: () => void;
  onOpenProject: () => void;
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
        <button type="button" className="btn btn--icon" aria-label="Settings" title="Settings">
          ⚙
        </button>
      </div>
    </header>
  );
}
