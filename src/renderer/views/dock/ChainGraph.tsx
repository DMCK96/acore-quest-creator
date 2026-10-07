import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Node,
  type NodeTypes,
  type Viewport as RFViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AppStore } from '../../state/app-store';
import type { CanvasNode } from '@shared/ipc';
import { QuestNodeCard } from '../QuestNodeCard';
import { toFlowEdges, type LinkEdge } from '../canvas-edges';
import { DRAG_LINK } from '@core/links/drag-link';
import { encodePart } from '../../world3d/chain-drop';
import { ChainLinkMenu } from './ChainLinkMenu';
import { partKey, usePlacedParts } from './usePlacedParts';
import { questParts, questRoles } from '@core/modules/quest-roles';
import { giverName } from '@core/modules/summaries';
import { EMPTY_ENTITIES } from '@core/entities/model';
import { useNameBook } from '../../state/names';
import { useProjectEntities } from '../../state/project-entities';
import './ChainGraph.css';

/** Drags and pans are queued locally and flushed together after the user pauses. */
const FLUSH_DEBOUNCE_MS = 300;
/** The keys that, held with a click, add a quest to the selection rather than replace it */
const MULTI_SELECT_KEYS = ['Control', 'Meta', 'Shift'];

interface QuestNodeData extends Record<string, unknown> {
  node: CanvasNode;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onAddChain: () => void;
  rotation: { name: string; daily: boolean } | null;
  onRotation: () => void;
  parts?: { key: string; name: string; focused: boolean; placed: boolean; drag: string }[];
}

/** A quest's card between its handles: a link is dragged out of the right one into another's left */
function QuestFlowNode({ data, isConnectable }: { data: QuestNodeData; isConnectable: boolean }): React.JSX.Element {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <QuestNodeCard
        node={data.node}
        selected={data.selected}
        onOpen={data.onOpen}
        onEdit={data.onEdit}
        onRemove={data.onRemove}
        onAddChain={data.onAddChain}
        rotation={data.rotation}
        onRotation={data.onRotation}
        parts={data.parts}
      />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </>
  );
}

const nodeTypes: NodeTypes = { quest: QuestFlowNode };

/**
 * The quest chain as a React Flow graph: one card per quest, the links between them, dragging,
 * panning and selecting. A drag from one quest's right handle to another's left links them; a turn-in
 * link is taken away from its right-click menu, any other kind is changed in the quest editor. Needs
 * a `ReactFlowProvider` above it; the selection is its host's, so the host's tools can act on it.
 */
export function ChainGraph({
  store,
  selectedIds,
  onSelectedIds,
  onRotation,
}: {
  store: AppStore;
  /** The quests selected on the graph (Ctrl, Cmd or Shift+click adds one, Shift+drag boxes several) */
  selectedIds: ReadonlySet<number>;
  onSelectedIds: Dispatch<SetStateAction<ReadonlySet<number>>>;
  /** Opens the rotation a quest's card is tagged with */
  onRotation(rotationId: number): void;
}): React.JSX.Element {
  const nodes = store((s) => s.nodes);
  const viewport = store((s) => s.viewport);
  const open = store((s) => s.open);
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
  const focus = store((s) => s.focus);
  const saving = store((s) => s.saving);
  // The quest editor is over the graph, or stepped aside while the author works in the World: a link
  // (which opens the quest it edits) would bring it back over what they are doing
  const editing = store((s) => s.screen === 'edit');
  const linkQuests = store((s) => s.linkQuests);
  const unlinkQuests = store((s) => s.unlinkQuests);
  const names = useNameBook();
  const entities = useProjectEntities()?.entities ?? EMPTY_ENTITIES;
  const openParts = useMemo(() => (open ? questParts(questRoles(open.aggregate.values)) : []), [open]);
  const placedParts = usePlacedParts(open?.questId ?? null, nodes);

  const { screenToFlowPosition, setViewport: setFlowViewport } = useReactFlow();
  // `<ReactFlow>` only honours `defaultViewport` at mount, so it stays unmounted until the saved
  // viewport has loaded, then mounts exactly once — never re-keyed, so nodes a test (or the user)
  // is holding a reference to never get silently detached from a remount.
  const [ready, setReady] = useState(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each card's size as React Flow last measured it. The nodes are rebuilt from the store on every
  // render, and one handed over without its size is hidden until measured again, so a double-click
  // whose first click opens the quest would land its second on the pane and make a new quest.
  const measured = useRef(new Map<string, { width: number; height: number }>());
  // The right-clicked link's menu: where, and what it offers
  const [linkMenu, setLinkMenu] = useState<{ at: { x: number; y: number }; label: string; run(): void } | null>(null);

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
  const multi = nodes.filter((n) => selectedIds.has(n.questId)).length >= 2;

  const flowNodes: Node[] = nodes.map((n) => ({
    id: String(n.questId),
    type: 'quest',
    position: { x: n.x, y: n.y },
    measured: measured.current.get(String(n.questId)),
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
        if (pool) onRotation(pool.id);
      },
      // The open quest's card lists its NPCs and objects, the one in focus and the ones already placed
      // marked; each drags onto the 3D view (again, for one placed: a second spawn is allowed)
      parts: open?.questId === n.questId
        ? openParts.map((t) => ({
            key: partKey(t.kind, t.id),
            name: giverName(t, names, entities),
            focused: focus.questId === n.questId && focus.part?.kind === t.kind && focus.part.entry === t.id,
            placed: placedParts.has(partKey(t.kind, t.id)),
            drag: encodePart({ kind: t.kind, entry: t.id }),
          }))
        : undefined,
    } satisfies QuestNodeData,
  }));

  const handlePaneDoubleClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    void newQuest(position);
  };

  const linkAction = (edge: LinkEdge): { label: string; run(): void } =>
    edge.data?.component === DRAG_LINK
      ? { label: 'Remove link', run: () => void unlinkQuests(Number(edge.source), Number(edge.target)) }
      : {
          label: 'Edit in the quest editor',
          // The quest that holds the link, the one whose fields say it
          run: () => {
            const owner = edge.data?.owner ?? Number(edge.source);
            void openQuest(owner).then((opened) => opened && store.getState().editQuest());
          },
        };

  return (
    <div className="chain-graph" onDoubleClick={handlePaneDoubleClick}>
      {ready && (
        <ReactFlow
          nodes={flowNodes}
          edges={toFlowEdges(nodes)}
          nodeTypes={nodeTypes}
          // The selection is outlined only while it holds several quests: one selected by a plain
          // click is the open quest, which has its own highlight that the outline could contradict
          className={multi ? 'canvas--multi' : undefined}
          zoomOnDoubleClick={false}
          // Below React Flow's floor of 0.5, so Fit view fits a long chain into a dock beside the world
          minZoom={0.2}
          defaultViewport={viewport}
          // No new link while a quest edit is on its way (the link edits a quest too), nor while editing
          nodesConnectable={!saving && !editing}
          onConnect={(connection) => void linkQuests(Number(connection.source), Number(connection.target))}
          onEdgeContextMenu={(event, edge) => {
            event.preventDefault();
            if (!editing) setLinkMenu({ at: { x: event.clientX, y: event.clientY }, ...linkAction(edge as LinkEdge) });
          }}
          // A click selects (Ctrl, Cmd or Shift adds); a drag moves without selecting. Nothing is deleted by key.
          multiSelectionKeyCode={MULTI_SELECT_KEYS}
          selectNodesOnDrag={false}
          deleteKeyCode={null}
          // React Flow keeps a multi-selection when a quest already in it is clicked plainly;
          // a plain click selects just that quest instead (the card itself opens it)
          onNodeClick={(event, node) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey) return;
            const id = Number(node.id);
            onSelectedIds((was) => (was.size === 1 && was.has(id) ? was : new Set([id])));
          }}
          // The nodes are controlled by the store, so a drag only shows if each step lands there.
          onNodesChange={(changes) => {
            const picks = changes.flatMap((c) => (c.type === 'select' ? [c] : []));
            if (picks.length > 0) {
              onSelectedIds((was) => {
                const next = new Set(was);
                for (const pick of picks) {
                  if (pick.selected) next.add(Number(pick.id));
                  else next.delete(Number(pick.id));
                }
                return next;
              });
            }
            for (const change of changes) {
              if (change.type === 'dimensions' && change.dimensions) measured.current.set(change.id, change.dimensions);
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
      {linkMenu && <ChainLinkMenu at={linkMenu.at} label={linkMenu.label} onPick={linkMenu.run} onClose={() => setLinkMenu(null)} />}
    </div>
  );
}
