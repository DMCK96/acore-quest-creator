import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeTypes,
  type Viewport as RFViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AppStore } from '../state/app-store';
import type { CanvasNode, GroupMove, SpawnGroup } from '@shared/ipc';
import { QuestNodeCard } from './QuestNodeCard';
import { toFlowEdges } from './canvas-edges';
import { QuestPreview } from './QuestPreview';
import { QuestFlowView } from './QuestFlowView';
import { AddExistingDialog } from './AddExistingDialog';
import { RotationDialog } from './RotationDialog';
import { QuestOrb } from '../components/QuestOrb';
import { AnimatedButton } from '../components/AnimatedButton';
import './CanvasHome.css';

/** Drags and pans are queued locally and flushed together after the user pauses. */
const FLUSH_DEBOUNCE_MS = 300;

interface QuestNodeData extends Record<string, unknown> {
  node: CanvasNode;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onAddChain: () => void;
  rotation: { name: string; daily: boolean } | null;
  onRotation: () => void;
}

function QuestFlowNode({ data }: { data: QuestNodeData }): React.JSX.Element {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <QuestNodeCard
        node={data.node}
        selected={data.selected}
        onOpen={data.onOpen}
        onEdit={data.onEdit}
        onRemove={data.onRemove}
        onAddChain={data.onAddChain}
        rotation={data.rotation}
        onRotation={data.onRotation}
      />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

const nodeTypes: NodeTypes = { quest: QuestFlowNode };

function CanvasInner({ store }: { store: AppStore }): React.JSX.Element {
  const nodes = store((s) => s.nodes);
  const viewport = store((s) => s.viewport);
  const open = store((s) => s.open);
  const screen = store((s) => s.screen);
  const loadNodes = store((s) => s.loadNodes);
  const moveNode = store((s) => s.moveNode);
  const setViewport = store((s) => s.setViewport);
  const flushMoves = store((s) => s.flushMoves);
  const openQuest = store((s) => s.openQuest);
  const newQuest = store((s) => s.newQuest);
  const removeNode = store((s) => s.removeNode);
  const addQuestChain = store((s) => s.addQuestChain);
  const projectEpoch = store((s) => s.projectEpoch);
  const questPools = store((s) => s.questPools);

  const { screenToFlowPosition, fitView, setViewport: setFlowViewport } = useReactFlow();
  const [showAddExisting, setShowAddExisting] = useState(false);
  // `<ReactFlow>` only honours `defaultViewport` at mount, so it stays unmounted until the saved
  // viewport has loaded, then mounts exactly once — never re-keyed, so nodes a test (or the user)
  // is holding a reference to never get silently detached from a remount.
  const [ready, setReady] = useState(false);
  // The quests selected on the graph (Ctrl or Cmd+click adds one, Shift+drag boxes several)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  // The rotation being made or changed, and whether it is one already saved (which can be deleted)
  const [rotationEdit, setRotationEdit] = useState<{ group: SpawnGroup; existing: boolean } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadNodes().then(() => setReady(true));
  }, [loadNodes]);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  // `<ReactFlow>` only reads `defaultViewport` at mount, so a project switch moves it explicitly.
  useEffect(() => {
    if (projectEpoch === 0) return;
    void setFlowViewport(store.getState().viewport);
  }, [projectEpoch, setFlowViewport, store]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      void flushMoves();
    }, FLUSH_DEBOUNCE_MS);
  }, [flushMoves]);

  const poolOf = new Map(questPools.flatMap((p) => p.questIds.map((id) => [id, p] as const)));
  const selected = nodes.filter((n) => selectedIds.has(n.questId)).map((n) => n.questId);

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

  const flowNodes: Node[] = nodes.map((n) => ({
    id: String(n.questId),
    type: 'quest',
    position: { x: n.x, y: n.y },
    draggable: true,
    selected: selectedIds.has(n.questId),
    data: {
      node: n,
      selected: open?.questId === n.questId,
      onOpen: () => void openQuest(n.questId),
      // Only the quest that actually opened is edited: a failed or superseded open leaves the old one.
      onEdit: () => void openQuest(n.questId).then((opened) => opened && store.getState().editQuest()),
      onRemove: () => void removeNode(n.questId),
      onAddChain: () => void addQuestChain(n.questId),
      rotation: poolOf.has(n.questId) ? { name: poolOf.get(n.questId)!.name || `Rotation ${poolOf.get(n.questId)!.id}`, daily: poolOf.get(n.questId)!.daily } : null,
      onRotation: () => {
        const pool = poolOf.get(n.questId);
        if (pool) void openRotation(pool.id);
      },
    } satisfies QuestNodeData,
  }));

  const handlePaneDoubleClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    void newQuest(position);
  };

  return (
    <div className="canvas-shell">
      <div className="canvas-body">
        <div className="canvas-pane" onDoubleClick={handlePaneDoubleClick}>
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
            {selected.length >= 2 && (
              <button type="button" className="btn" onClick={() => void openNewRotation(selected)}>
                Rotate these quests…
              </button>
            )}
          </div>
          {nodes.length === 0 && (
            <div className="canvas-empty">
              <div className="canvas-empty__circle" data-orb-target="">
                <QuestOrb />
                <div className="canvas-empty__content">
                  <svg className="canvas-empty__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 3.5h10.5a2 2 0 0 1 2 2V17" />
                    <path d="M7 3.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V17H9v1.5a2 2 0 0 1-2 2" />
                    <path d="M9 8h7M9 11.5h7" />
                  </svg>
                  <h2 className="canvas-empty__title">Quests</h2>
                  <p className="canvas-empty__subtitle">
                    No quests in this project yet. Write one from scratch, or bring in an existing chain from the world database to rework it.
                  </p>
                  <div className="canvas-empty__actions">
                    <AnimatedButton className="canvas-empty__btn" onClick={() => void newQuest()}>
                      <svg className="canvas-empty__btn-icon" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M8 2v12M2 8h12" />
                      </svg>
                      Create New Quest
                    </AnimatedButton>
                    <AnimatedButton className="canvas-empty__btn" onClick={() => setShowAddExisting(true)}>
                      <svg className="canvas-empty__btn-icon" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
                        <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
                      </svg>
                      Add Existing Quest Chain
                    </AnimatedButton>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div style={{ position: 'absolute', inset: 0 }}>
            {ready && (
              <ReactFlow
                nodes={flowNodes}
                edges={toFlowEdges(nodes)}
                nodeTypes={nodeTypes}
                zoomOnDoubleClick={false}
                defaultViewport={viewport}
                nodesConnectable={false}
                // A click selects (Ctrl or Cmd adds); a drag moves without selecting. Nothing is deleted by key.
                selectNodesOnDrag={false}
                deleteKeyCode={null}
                // The nodes are controlled by the store, so a drag only shows if each step lands there.
                onNodesChange={(changes) => {
                  const picks = changes.flatMap((c) => (c.type === 'select' ? [c] : []));
                  if (picks.length > 0) {
                    setSelectedIds((was) => {
                      const next = new Set(was);
                      for (const pick of picks) {
                        if (pick.selected) next.add(Number(pick.id));
                        else next.delete(Number(pick.id));
                      }
                      return next;
                    });
                  }
                  for (const change of changes) {
                    if (change.type !== 'position') continue;
                    if (change.position) moveNode(Number(change.id), change.position.x, change.position.y);
                    if (change.dragging === false) scheduleFlush();
                  }
                }}
                onMoveEnd={(_, vp: RFViewport) => {
                  setViewport(vp);
                  scheduleFlush();
                }}
              >
                <Background color="var(--border-soft)" gap={18} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor="var(--accent)"
                  maskColor="rgba(0, 0, 0, 0.6)"
                  style={{ background: 'transparent' }}
                />
                <Controls showInteractive={false} />
              </ReactFlow>
            )}
          </div>
        </div>
        {screen === 'preview' && <QuestPreview store={store} />}
        {screen === 'edit' && <QuestFlowView store={store} />}
      </div>
      {showAddExisting && <AddExistingDialog store={store} onClose={() => setShowAddExisting(false)} />}
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

export function CanvasHome({ store }: { store: AppStore }): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner store={store} />
    </ReactFlowProvider>
  );
}
