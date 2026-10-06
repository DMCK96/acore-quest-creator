import { useRef, useState } from 'react';
import type { CanvasNode, StartBadge } from '@shared/ipc';
import { CHAIN_DRAG_TYPE } from '../world3d/chain-drop';
import './QuestNodeCard.css';

/** Roughly the width a node occupies on the canvas; used to lay out new nodes. */
export const NODE_WIDTH = 220;

const countLabel = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** How this quest is offered, shown in the fixed order `CanvasNode.starts` already carries. */
const START_BADGE: Record<StartBadge, { text: string; title: string }> = {
  npc: { text: 'NPC', title: 'Offered by an NPC' },
  object: { text: 'Object', title: 'Offered by an object' },
  event: { text: 'Event', title: 'Offered during a game event' },
  item: { text: 'Item', title: 'Begun by an item' },
  script: { text: 'Script', title: 'Offered by a SmartAI script' },
  backend: { text: 'Backend', title: 'Started by backend' },
};

const GROUP_LABEL: Record<'pickOne' | 'finishAll', string> = { pickOne: 'Pick one', finishAll: 'Finish all' };

/** Shown as the `title` of the "Not connected" chip, so hovering explains what it means. */
export const NOT_CONNECTED_MESSAGE = 'Not connected to any other quest on the canvas.';

/** How far the pointer may move between press and release for it to still count as a click. */
const DRAG_SLOP_PX = 4;

export function QuestNodeCard({
  node,
  selected,
  onOpen,
  onEdit,
  onRemove,
  onAddChain,
  rotation,
  onRotation,
  parts,
}: {
  node: CanvasNode;
  selected: boolean;
  /**
   * The NPCs and objects with a part in the quest, listed on the open quest's card; the focused one and
   * those already placed in the world are marked. Each is dragged out (onto the 3D view, to place it,
   * or place another) as its `drag` data.
   */
  parts?: { key: string; name: string; focused: boolean; placed?: boolean; drag: string }[];
  /** The quest rotation this quest is in, if any */
  rotation?: { name: string; daily: boolean } | null;
  /** The rotation tag's click: open the rotation */
  onRotation?: () => void;
  /** A single click: preview the quest. */
  onOpen?: () => void;
  /** A double click: edit the quest. */
  onEdit?: () => void;
  onRemove?: () => void;
  onAddChain?: () => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  // A drag ends in a click too; only a press that stayed put is a click on the card.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const title = node.title.trim() === '' ? '(untitled quest)' : node.title;
  const label = `Quest ${node.questId}: ${title}`;
  const statusClass = node.unsafe ? 'quest-card--unsafe' : node.exported ? 'quest-card--exported' : node.isNew ? 'quest-card--new' : '';

  return (
    <div
      data-testid="quest-node"
      className={`quest-card ${statusClass}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      style={{ width: NODE_WIDTH }}
      onMouseDown={(e) => {
        pressedAt.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const at = pressedAt.current;
        if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > DRAG_SLOP_PX) return;
        // Ctrl, Cmd or Shift with a click adds the quest to the selection; it does not open it
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        onOpen?.();
      }}
      onDoubleClick={() => (onEdit ?? onOpen)?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen?.();
      }}
    >
      <div className="quest-card__title">{title}</div>
      <div className="quest-card__meta">
        <span>#{node.questId}</span>
        <span>Level {node.level}</span>
      </div>
      <div className="quest-card__chips">
        {node.isNew && <span className="chip chip--blue">New</span>}
        {node.exported && <span className="chip chip--green">Exported</span>}
        {node.unsafe && <span className="chip chip--red">Unsafe</span>}
        {node.errors > 0 && <span className="chip chip--red">{countLabel(node.errors, 'error')}</span>}
        {node.warnings > 0 && <span className="chip chip--amber">{countLabel(node.warnings, 'warning')}</span>}
        {node.starts.map((badge) => (
          <span key={badge} className="chip chip--start" title={START_BADGE[badge].title}>
            {START_BADGE[badge].text}
          </span>
        ))}
        {rotation && (
          <button
            type="button"
            className="chip chip--rotation nodrag"
            onClick={(e) => {
              e.stopPropagation();
              onRotation?.();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {`${rotation.daily ? 'Daily' : 'Weekly'} rotation: ${rotation.name}`}
          </button>
        )}
        {node.groups.map((g) => (
          <span key={g.group} className="chip chip--group" title={`Exclusive group ${g.group}`}>
            {GROUP_LABEL[g.kind]}
          </span>
        ))}
        {node.notConnected && (
          <span className="chip chip--amber" title={NOT_CONNECTED_MESSAGE}>
            Not connected
          </span>
        )}
      </div>
      {parts && parts.length > 0 && (
        <ul className="quest-card__parts" aria-label="Parts">
          {parts.map((part) => (
            <li
              key={part.key}
              // nodrag: dragging the row carries the part out, and leaves the card where it is
              className="quest-card__part nodrag"
              aria-current={part.focused ? 'true' : undefined}
              title={part.placed ? 'Already placed in the world; drag onto the 3D view to place another' : 'Drag onto the 3D view to place it'}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(CHAIN_DRAG_TYPE, part.drag);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="quest-card__part-name">{part.name}</span>
              {part.placed && <span className="quest-card__placed">Placed</span>}
            </li>
          ))}
        </ul>
      )}
      {node.offCanvasLinks > 0 && (
        <button
          type="button"
          className="quest-card__more nodrag"
          aria-label={`Add ${node.offCanvasLinks} linked quest${node.offCanvasLinks === 1 ? '' : 's'} not on the canvas`}
          onClick={(e) => {
            e.stopPropagation();
            onAddChain?.();
          }}
        >
          +{node.offCanvasLinks} linked
        </button>
      )}
      <button
        type="button"
        className="quest-card__remove nodrag"
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        Remove quest {node.questId} from canvas
      </button>
      {confirming && (
        <div role="alertdialog" className="quest-card__confirm nodrag nopan">
          <p>This removes it from this project only. Nothing in your database changes.</p>
          <div className="quest-card__confirm-actions">
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(false);
                onRemove?.();
              }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
