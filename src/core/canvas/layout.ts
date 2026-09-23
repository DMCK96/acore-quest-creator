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

/** A quest's place in a chain layout: columns run left to right in chain order. */
export interface ChainSlot {
  column: number;
  row: number;
}

/**
 * Lays a quest chain out as columns: each quest sits one column to the right of its deepest parent,
 * and quests sharing a column are stacked in their parents' order. A cycle cannot push a quest further right
 * than there are quests, so the walk always ends.
 */
export function layoutChain(
  questIds: readonly number[],
  links: readonly { from: number; to: number }[],
): Map<number, ChainSlot> {
  const depth = new Map<number, number>(questIds.map((id) => [id, 0]));
  const cap = questIds.length - 1;
  for (let pass = 0; pass < questIds.length; pass++) {
    let changed = false;
    for (const { from, to } of links) {
      const want = Math.min((depth.get(from) ?? 0) + 1, cap);
      if (depth.has(to) && want > (depth.get(to) ?? 0)) {
        depth.set(to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Columns are stacked left to right, each quest ordered by the average row of its parents in
  // earlier columns (ID breaks ties), so a branch stays level with the quest it follows instead of
  // crossing its sibling. A quest with no earlier parent (a root, or one on a cycle) sorts last.
  const columns = new Map<number, number[]>();
  for (const id of questIds) {
    const column = depth.get(id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), id]);
  }
  const slots = new Map<number, ChainSlot>();
  const parentRow = (id: number): number => {
    const column = depth.get(id) ?? 0;
    const rows = links
      .filter((l) => l.to === id && (depth.get(l.from) ?? column) < column)
      .map((l) => slots.get(l.from)?.row ?? 0);
    return rows.length === 0 ? Infinity : rows.reduce((a, b) => a + b, 0) / rows.length;
  };
  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const ids = columns.get(column) ?? [];
    const keys = new Map(ids.map((id) => [id, parentRow(id)]));
    ids.sort((a, b) => (keys.get(a) ?? 0) - (keys.get(b) ?? 0) || a - b);
    ids.forEach((id, row) => slots.set(id, { column, row }));
  }
  return slots;
}
