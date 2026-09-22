import { useState } from 'react';
import type { CanvasNode } from '@shared/ipc';

/** Roughly the width a node occupies on the canvas; used to lay out new nodes. */
export const NODE_WIDTH = 220;

const countLabel = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function QuestNodeCard({
  node,
  selected,
  onOpen,
  onRemove,
}: {
  node: CanvasNode;
  selected: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const title = node.title.trim() === '' ? '(untitled quest)' : node.title;
  const label = `Quest ${node.questId}: ${title}`;

  return (
    <div
      data-testid="quest-node"
      className="nodrag nopan"
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
      <div>{title}</div>
      <div>#{node.questId}</div>
      <div>Level {node.level}</div>
      {node.isNew && <span>New</span>}
      {node.exported && <span>Exported</span>}
      {node.unsafe && <span>Unsafe</span>}
      {node.errors > 0 && <span>{countLabel(node.errors, 'error')}</span>}
      {node.warnings > 0 && <span>{countLabel(node.warnings, 'warning')}</span>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        Remove quest {node.questId} from canvas
      </button>
      {confirming && (
        <div role="alertdialog">
          <p>This removes the draft only. Nothing in your database changes.</p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
              onRemove?.();
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
