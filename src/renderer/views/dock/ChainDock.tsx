import { useRef, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { AppStore } from '../../state/app-store';
import type { GroupMove, SpawnGroup } from '@shared/ipc';
import { ChainGraph } from './ChainGraph';
import { ChainEmpty } from './ChainEmpty';
import { QuestPicker } from '../QuestPicker';
import { QuestPreview } from '../QuestPreview';
import { QuestFlowView } from '../QuestFlowView';
import { AddExistingDialog } from '../AddExistingDialog';
import { RotationDialog } from '../RotationDialog';
import './ChainDock.css';

/**
 * The quest chain, docked under or beside the world: the quest tools and search over the graph, the
 * open quest's preview beside it, and the dialogs the tools open.
 */
export function ChainDock({ store }: { store: AppStore }): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <ChainDockInner store={store} />
    </ReactFlowProvider>
  );
}

function ChainDockInner({ store }: { store: AppStore }): React.JSX.Element {
  const nodes = store((s) => s.nodes);
  const screen = store((s) => s.screen);
  const newQuest = store((s) => s.newQuest);
  const questPools = store((s) => s.questPools);
  const { fitView } = useReactFlow();
  const pane = useRef<HTMLDivElement | null>(null);
  const [showAddExisting, setShowAddExisting] = useState(false);
  const [finding, setFinding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  // The rotation being made or changed, and whether it is one already saved (which can be deleted)
  const [rotationEdit, setRotationEdit] = useState<{ group: SpawnGroup; existing: boolean } | null>(null);

  const selected = nodes.filter((n) => selectedIds.has(n.questId)).map((n) => n.questId);

  const paneCenter = (): { x: number; y: number } => {
    const rect = pane.current!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const toggleFinding = (): void => {
    // A fresh search each time it unfolds, not the last one's results
    if (!finding) void store.getState().search('');
    setFinding(!finding);
  };
  const openNewRotation = async (questIds: number[]): Promise<void> => {
    const group = await store.getState().newRotation(questIds);
    if (group) setRotationEdit({ group, existing: false });
  };
  const openRotation = async (id: number): Promise<void> => {
    const group = await store.getState().readRotation(id);
    if (group) setRotationEdit({ group, existing: true });
  };
  // Each quest's title and kind: the graph's, else the rotation's kind for a quest only the database has
  const rotationTitles = (group: SpawnGroup): Map<number, { title: string; daily: boolean; weekly: boolean }> => {
    const titles = new Map<number, { title: string; daily: boolean; weekly: boolean }>();
    for (const n of nodes) titles.set(n.questId, { title: n.title.trim() || '(untitled quest)', daily: n.daily === true, weekly: n.weekly === true });
    const pool = questPools.find((p) => p.id === group.id);
    for (const m of group.members) {
      if (m.type !== 'quest' || titles.has(m.questId) || !pool) continue;
      titles.set(m.questId, { title: `Quest ${m.questId}`, daily: pool.daily, weekly: !pool.daily });
    }
    return titles;
  };

  return (
    <div className="chain-dock" data-testid="chain-dock">
      <div ref={pane} className="chain-dock__pane">
        <div className="chain-dock__corner">
          <div className="quest-tools glass" role="toolbar" aria-label="Quest tools">
            <button type="button" className="btn" onClick={() => void newQuest()}>
              New quest
            </button>
            <button type="button" className="btn" onClick={() => setShowAddExisting(true)}>
              Add existing quest
            </button>
            <button type="button" className="btn" onClick={() => void fitView()}>
              Fit view
            </button>
            <button type="button" className="btn" aria-expanded={finding} aria-controls="chain-dock-find" onClick={toggleFinding}>
              Find a quest
            </button>
            {selected.length >= 2 && (
              <button type="button" className="btn" onClick={() => void openNewRotation(selected)}>
                Rotate these quests…
              </button>
            )}
          </div>
          {finding && (
            <div id="chain-dock-find" className="chain-dock__find glass">
              <QuestPicker store={store} showNewQuestButton={false} autoFocus />
            </div>
          )}
        </div>
        {nodes.length === 0 && <ChainEmpty onNewQuest={() => void newQuest()} onAddExisting={() => setShowAddExisting(true)} />}
        <ChainGraph store={store} selectedIds={selectedIds} onSelectedIds={setSelectedIds} onRotation={(id) => void openRotation(id)} />
      </div>
      {screen === 'preview' && <QuestPreview store={store} />}
      {/* The quest editor, over the dock, until it moves to a modal of its own */}
      {screen === 'edit' && <QuestFlowView store={store} />}
      {showAddExisting && <AddExistingDialog store={store} center={paneCenter} onClose={() => setShowAddExisting(false)} />}
      {rotationEdit && (
        <RotationDialog
          group={rotationEdit.group}
          titles={rotationTitles(rotationEdit.group)}
          projectQuests={nodes.map((n) => ({ questId: n.questId, title: n.title }))}
          check={(group: SpawnGroup, moves: GroupMove[]) => store.getState().checkRotation(group, moves)}
          onSave={(group, moves, makeKind) =>
            void store
              .getState()
              .saveRotation(group, moves, makeKind)
              .then((saved) => saved && setRotationEdit(null))
          }
          onDelete={
            rotationEdit.existing
              ? () =>
                  void store
                    .getState()
                    .deleteRotation(rotationEdit.group.id, rotationEdit.group.name)
                    .then((deleted) => deleted && setRotationEdit(null))
              : undefined
          }
          onClose={() => setRotationEdit(null)}
        />
      )}
    </div>
  );
}
