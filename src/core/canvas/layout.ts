/**
 * Where a new quest node goes on the canvas.
 *
 * The canvas is free-form: nodes can be dragged anywhere and are saved where the user left them.
 * A node created without a position still has to land somewhere sensible, so the tool walks a
 * fixed grid and takes the first slot no existing node overlaps.
 */

/** The size of a quest node card, in canvas units. */
export const NODE_SIZE = { width: 260, height: 110 } as const;

/** The spacing between grid slots: one node plus a gap. */
export const NODE_GRID = { x: 320, y: 180 } as const;

/** Nodes per row before the next row starts. */
const COLUMNS = 4;

/** How close a node has to be to a slot before it counts as sitting in it. */
const MARGIN = 20;

const OCCUPIED = { x: NODE_SIZE.width + MARGIN, y: NODE_SIZE.height + MARGIN } as const;

const slot = (index: number): { x: number; y: number } => ({
  x: (index % COLUMNS) * NODE_GRID.x,
  y: Math.floor(index / COLUMNS) * NODE_GRID.y,
});

/**
 * The first grid slot no existing node overlaps.
 *
 * A dragged node blocks at most two slots per axis, so among the first `4n + 1` slots one is always
 * free for `n` nodes: the search is bounded and never runs away.
 */
export function nextNodePosition(existing: readonly { x: number; y: number }[]): { x: number; y: number } {
  const limit = existing.length * 4 + 1;
  for (let index = 0; index < limit; index++) {
    const at = slot(index);
    const taken = existing.some(
      (node) => Math.abs(node.x - at.x) < OCCUPIED.x && Math.abs(node.y - at.y) < OCCUPIED.y,
    );
    if (!taken) return at;
  }
  return slot(limit);
}
