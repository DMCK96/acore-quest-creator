import { useState } from 'react';
import type { CanvasNode, StartBadge } from '@shared/ipc';
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

export function QuestNodeCard({
  node,
  selected,
  onOpen,
  onRemove,
  onAddChain,
}: {
  node: CanvasNode;
  selected: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
  onAddChain?: () => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const title = node.title.trim() === '' ? '(untitled quest)' : node.title;
  const label = `Quest ${node.questId}: ${title}`;
  const statusClass = node.unsafe ? 'quest-card--unsafe' : node.exported ? 'quest-card--exported' : node.isNew ? 'quest-card--new' : '';

  return (
    <div
      data-testid="quest-node"
      className={`quest-card nodrag nopan ${statusClass}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      style={{ width: NODE_WIDTH }}
      onDoubleClick={() => onOpen?.()}
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
      {node.offCanvasLinks > 0 && (
        <button
          type="button"
          className="quest-card__more"
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
        className="quest-card__remove"
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        Remove quest {node.questId} from canvas
      </button>
      {confirming && (
        <div role="alertdialog" className="quest-card__confirm">
          <p>This removes the draft only. Nothing in your database changes.</p>
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
