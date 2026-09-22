import type { ActiveView, AppStore, EditorGroup } from '../state/app-store';
import { FidelityBanner } from '../components/FidelityBanner';
import { IssuesList } from '../components/IssuesList';
import { ChangesView } from './ChangesView';
import { ExportBar } from './ExportBar';
import { UnmodelledPanel } from './UnmodelledPanel';
import { GroupPanel } from '../groups/GroupPanel';
import { ObjectivesPanel } from '../groups/ObjectivesPanel';
import './QuestWorkspace.css';

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
  const setValue = store((s) => s.setValue);

  if (!open) return null;

  const titleValue = open.aggregate.values['quest_template.LogTitle'];
  const title = typeof titleValue === 'string' ? titleValue : '';

  return (
    <div>
      <button type="button" className="btn workspace__back" onClick={backToPicker}>
        ← Back to quests
      </button>
      <h1 className="workspace__title">
        {title} &mdash; {open.questId}
      </h1>
      <FidelityBanner fidelity={open.fidelity} />
      <ExportBar store={store} />
      <div role="tablist" className="workspace__tabs">
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
      <div role="tabpanel" className="workspace__panel">
        {activeView === 'unmodelled' && <UnmodelledPanel unmodelled={open.unmodelled} />}
        {activeView === 'changes' && <ChangesView store={store} />}
        {activeView === 'objectives' && (
          <ObjectivesPanel aggregate={open.aggregate} onChange={setValue} />
        )}
        {GROUP_TABS.some((t) => t.view === activeView) && activeView !== 'objectives' && (
          <GroupPanel group={activeView as EditorGroup} aggregate={open.aggregate} onChange={setValue} />
        )}
      </div>
      <IssuesList issues={issues} />
    </div>
  );
}
