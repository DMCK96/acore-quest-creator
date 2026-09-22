import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
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
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }} onDoubleClick={handlePaneDoubleClick}>
        <div>
          <button type="button" onClick={() => void newQuest()}>
            New quest
          </button>
          <button type="button" onClick={() => setShowAddExisting(true)}>
            Add existing quest
          </button>
          <button type="button" onClick={() => void fitView()}>
            Fit view
          </button>
        </div>
        {nodes.length === 0 && (
          <p>Double-click anywhere to start your first quest, or add one that already exists in your database.</p>
        )}
        <div style={{ position: 'absolute', inset: 0, top: '2.5em' }}>
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
              <Background />
            </ReactFlow>
          )}
        </div>
      </div>
      {screen === 'edit' && <EditorDrawer store={store} />}
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
