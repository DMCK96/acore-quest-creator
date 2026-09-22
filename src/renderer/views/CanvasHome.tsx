import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeTypes,
  type Viewport as RFViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AppStore } from '../state/app-store';
import type { CanvasNode } from '@shared/ipc';
import { QuestNodeCard } from './QuestNodeCard';
import { EditorDrawer } from './EditorDrawer';
import { AddExistingDialog } from './AddExistingDialog';
import { TopBar } from '../components/TopBar';
import { ErrorBanner } from '../components/ErrorBanner';
import './CanvasHome.css';

/** Drags and pans are queued locally and flushed together after the user pauses. */
const FLUSH_DEBOUNCE_MS = 300;

interface QuestNodeData extends Record<string, unknown> {
  node: CanvasNode;
  selected: boolean;
  onOpen: () => void;
  onRemove: () => void;
}

function QuestFlowNode({ data }: { data: QuestNodeData }): React.JSX.Element {
  return <QuestNodeCard node={data.node} selected={data.selected} onOpen={data.onOpen} onRemove={data.onRemove} />;
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

  const { screenToFlowPosition, fitView } = useReactFlow();
  const [showAddExisting, setShowAddExisting] = useState(false);
  // `<ReactFlow>` only honours `defaultViewport` at mount, so it stays unmounted until the saved
  // viewport has loaded, then mounts exactly once — never re-keyed, so nodes a test (or the user)
  // is holding a reference to never get silently detached from a remount.
  const [ready, setReady] = useState(false);
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

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      void flushMoves();
    }, FLUSH_DEBOUNCE_MS);
  }, [flushMoves]);

  const flowNodes: Node[] = nodes.map((n) => ({
    id: String(n.questId),
    type: 'quest',
    position: { x: n.x, y: n.y },
    draggable: true,
    data: {
      node: n,
      selected: open?.questId === n.questId,
      onOpen: () => void openQuest(n.questId),
      onRemove: () => void removeNode(n.questId),
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
      <TopBar
        store={store}
        onNewQuest={() => void newQuest()}
        onAddExisting={() => setShowAddExisting(true)}
        onFitView={() => void fitView()}
      />
      <ErrorBanner store={store} />
      <div className="canvas-body">
        <div className="canvas-pane" onDoubleClick={handlePaneDoubleClick}>
          {nodes.length === 0 && (
            <div className="canvas-empty">
              <div className="canvas-empty__circle">
                <div className="canvas-empty__icon">📜</div>
                <h2 className="canvas-empty__title">Start Your Journey</h2>
                <p className="canvas-empty__subtitle">
                  Begin by adding your first quest or an existing quest chain to the canvas.
                </p>
                <div className="canvas-empty__actions">
                  <button type="button" className="btn btn--primary" onClick={() => void newQuest()}>
                    + Create New Quest
                  </button>
                  <button type="button" className="btn" onClick={() => setShowAddExisting(true)}>
                    Add Existing Quest Chain
                  </button>
                </div>
              </div>
            </div>
          )}
          <div style={{ position: 'absolute', inset: 0 }}>
            {ready && (
              <ReactFlow
                nodes={flowNodes}
                edges={[]}
                nodeTypes={nodeTypes}
                zoomOnDoubleClick={false}
                defaultViewport={viewport}
                nodesConnectable={false}
                onNodeDragStop={(_, node) => {
                  moveNode(Number(node.id), node.position.x, node.position.y);
                  scheduleFlush();
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
        {screen === 'edit' && <EditorDrawer store={store} />}
      </div>
      {showAddExisting && <AddExistingDialog store={store} onClose={() => setShowAddExisting(false)} />}
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
