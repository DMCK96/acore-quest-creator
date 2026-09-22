import type { ActiveView, AppStore, EditorGroup } from '../state/app-store';
import { FidelityBanner } from '../components/FidelityBanner';
import { IssuesList } from '../components/IssuesList';

const GROUP_TABS: { view: EditorGroup; label: string }[] = [
  { view: 'identity', label: 'Identity' },
  { view: 'story', label: 'Story' },
  { view: 'objectives', label: 'Objectives' },
  { view: 'rewards', label: 'Rewards' },
  { view: 'availability', label: 'Availability' },
  { view: 'map', label: 'Map' },
];

const SIDE_TABS: { view: ActiveView; label: string }[] = [
  { view: 'unmodelled', label: 'Unmodelled columns' },
  { view: 'changes', label: 'Changes' },
];

const TABS = [...GROUP_TABS, ...SIDE_TABS];

export function QuestWorkspace({ store }: { store: AppStore }): React.JSX.Element | null {
  const open = store((s) => s.open);
  const activeView = store((s) => s.activeView);
  const issues = store((s) => s.issues);
  const setActiveView = store((s) => s.setActiveView);
  const backToPicker = store((s) => s.backToPicker);

  if (!open) return null;

  const titleValue = open.aggregate.values['quest_template.LogTitle'];
  const title = typeof titleValue === 'string' ? titleValue : '';

  return (
    <div>
      <button type="button" onClick={backToPicker}>
        Back to quests
      </button>
      <h1>
        {title} &mdash; {open.questId}
      </h1>
      <FidelityBanner fidelity={open.fidelity} />
      <div role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            role="tab"
            type="button"
            aria-selected={activeView === tab.view}
            onClick={() => setActiveView(tab.view)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {activeView === 'unmodelled' && (
          <ul>
            {open.unmodelled.map((u, i) => (
              <li key={i}>
                {u.table}.{u.column}
              </li>
            ))}
          </ul>
        )}
        {activeView === 'changes' && <p>Changes preview is not implemented yet.</p>}
        {GROUP_TABS.some((t) => t.view === activeView) && (
          <p>{GROUP_TABS.find((t) => t.view === activeView)?.label} editor is not implemented yet.</p>
        )}
      </div>
      <IssuesList issues={issues} />
    </div>
  );
}
