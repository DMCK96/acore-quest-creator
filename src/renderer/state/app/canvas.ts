import type { CanvasNode, QuestPoolSummary, Result, Viewport } from '@shared/ipc';
import type { SliceArgs } from './types';

/** The quest graph: its nodes, their places, the viewport, and the rotations it tags */
export interface CanvasSlice {
  nodes: CanvasNode[];
  /** Every quest rotation (quest pool), the world layer's copy over the database's; loaded with the graph */
  questPools: QuestPoolSummary[];
  viewport: Viewport;
  loadNodes(): Promise<void>;
  loadQuestPools(): Promise<void>;
  moveNode(questId: number, x: number, y: number): void;
  setViewport(v: Viewport): void;
  flushMoves(): Promise<void>;
  removeNode(questId: number): Promise<void>;
}

export function createCanvasSlice({ api, kit, set, get }: SliceArgs): CanvasSlice {
  return {
    nodes: [],
    questPools: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    async loadNodes() {
      const token = ++kit.nodesToken;
      const [nodesResult, read, pools] = await Promise.all([api.listNodes(), kit.readProject(), api.questPools()]);
      if (token !== kit.nodesToken) return;
      if (nodesResult.ok) set({ nodes: nodesResult.value });
      if (pools.ok) set({ questPools: pools.value });
      const projectResult = read.result;
      if (projectResult.ok && read.token === kit.projectToken) {
        kit.lastSavedViewport = projectResult.value.viewport;
        set({ viewport: projectResult.value.viewport, project: projectResult.value });
      }
    },
    async loadQuestPools() {
      const pools = await api.questPools();
      if (pools.ok) set({ questPools: pools.value });
    },
    moveNode(questId, x, y) {
      kit.pendingMoves.set(questId, { x, y });
      set((s) => ({
        nodes: s.nodes.map((n) => (n.questId === questId ? { ...n, x, y } : n)),
      }));
    },
    setViewport(v) {
      if (!kit.viewportsEqual(kit.lastSavedViewport, v)) kit.pendingViewport = v;
      set({ viewport: v });
    },
    async flushMoves() {
      const moves = Array.from(kit.pendingMoves.entries()).map(([questId, pos]) => ({ questId, ...pos }));
      kit.pendingMoves.clear();
      const viewportToSave = kit.pendingViewport;
      kit.pendingViewport = null;

      const tasks: Promise<Result<unknown>>[] = [];
      if (moves.length > 0) tasks.push(api.moveNodes(moves));
      if (viewportToSave) {
        kit.lastSavedViewport = viewportToSave;
        tasks.push(api.saveViewport(viewportToSave));
      }
      // A dropped layout save used to vanish: the results were awaited and then thrown away.
      const failed = (await Promise.all(tasks)).find((r) => !r.ok);
      if (failed && !failed.ok) set({ error: failed.error.message });
      if (tasks.length > 0) await get().loadProjectState();
    },
    async removeNode(questId) {
      const result = await api.removeNode(questId);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set((s) => ({ nodes: s.nodes.filter((n) => n.questId !== questId) }));
      await get().loadProjectState();
    },
  };
}
