import { EMPTY_WORLD, groupsOf, type WorldLayer } from '@core/world/layer';
import { EMPTY_ENTITIES, newItem, newNpc, newObject, type CustomItem, type CustomNpc, type CustomObject, type ProjectEntities } from '@core/entities/model';
import type { SliceArgs } from './types';

/** The project's NPCs, objects and items, and the world layer */
export interface WorldSlice {
  /** The project's new NPCs, objects and items, as edited here (sent after a pause, like quest edits) */
  entities: ProjectEntities;
  /** Moves each time the store is replaced from the main process (an undo, a load), for the views to redraw */
  entitiesSeq: number;
  /** The world layer: the project's changes to the world, kept here for the tracked list */
  layer: WorldLayer;
  /** The world layer as an undo or redo left it, with a count that moves each time, for the views to take */
  worldLayer: { layer: WorldLayer; seq: number } | null;
  /** Replaces the project's NPCs, objects and items here at once, and sends them after the pause */
  setEntities(next: ProjectEntities): void;
  /** Sends the project's NPCs, objects and items now if an edit is waiting */
  flushEntities(): Promise<void>;
  /** Reads the project's NPCs, objects and items from the main process */
  loadEntities(): Promise<void>;
  /** Reads the world layer from the main process */
  loadLayer(): Promise<void>;
  /** Keeps a layer the 3D view or a revert produced */
  setLayer(layer: WorldLayer): void;
  /**
   * Deletes one of the project's NPCs, objects or items, emptying every giver card that named it, as one
   * undo step; the open quest shows the cards as they now are. Returns the error to show, or null.
   */
  deleteEntity(kind: 'npc' | 'object' | 'item', entry: number): Promise<string | null>;
  /**
   * Makes a new NPC, object or item with a fresh ID, attached to no quest (a quest uses it by naming
   * it), and sends it at once so it is its own undo step before an editor opens on it
   */
  createEntity(kind: 'npc' | 'object' | 'item', preset: Partial<CustomNpc> | Partial<CustomObject> | Partial<CustomItem>): Promise<{ entry: number } | { error: string }>;
  /**
   * Brings an NPC, object or item the database already has into the store, read as the database has it,
   * and sends it at once as its own undo step; one the store has already is left as it is
   */
  adoptEntity(kind: 'npc' | 'object' | 'item', entry: number): Promise<{ entry: number } | { error: string }>;
}

export function createWorldSlice({ api, kit, set, get }: SliceArgs): WorldSlice {
  return {
    entities: structuredClone(EMPTY_ENTITIES),
    entitiesSeq: 0,
    layer: EMPTY_WORLD,
    worldLayer: null,
    setEntities(next) {
      set({ entities: next });
      kit.entitiesPending = true;
      if (kit.entitiesTimer) clearTimeout(kit.entitiesTimer);
      kit.entitiesTimer = setTimeout(() => {
        kit.entitiesTimer = null;
        void get().flushEntities();
      }, kit.saveDelayMs);
    },
    async flushEntities() {
      if (kit.entitiesTimer) clearTimeout(kit.entitiesTimer);
      kit.entitiesTimer = null;
      if (!kit.entitiesPending) return;
      kit.entitiesPending = false;
      const sent = await api.putProjectEntities(get().entities);
      if (!sent.ok) {
        set({ error: sent.error.message });
        // What the main process kit.holds is the truth: the edit it refused is not kept here
        await get().loadEntities();
        await get().loadLayer();
        return;
      }
      // A spawn taken off an NPC or object left its spawn group
      await get().loadLayer();
      await get().loadProjectState();
    },
    async loadEntities() {
      const read = await api.projectEntities();
      if (read.ok) set({ entities: read.value, entitiesSeq: ++kit.entitiesSeq });
    },
    async loadLayer() {
      const read = await api.worldLayer();
      if (read.ok) set({ layer: read.value });
    },
    setLayer(layer) {
      const groupsChanged = JSON.stringify(groupsOf(get().layer)) !== JSON.stringify(groupsOf(layer));
      set({ layer });
      // A rotation's tags on the graph follow the layer's groups (a revert in Project changes)
      if (groupsChanged) void get().loadQuestPools();
    },
    async deleteEntity(kind, entry) {
      await get().flushAll();
      const result = await api.deleteEntity(kind, entry);
      if (!result.ok) {
        set({ error: result.error.message });
        return result.error.message;
      }
      set({ entities: result.value.entities, entitiesSeq: ++kit.entitiesSeq });
      // Its spawns left their spawn groups in the same step
      await get().loadLayer();
      const open = get().open;
      const mine = open ? result.value.quests.find((q) => q.questId === open.questId) : undefined;
      if (open && mine) set({ open: { ...open, aggregate: mine.aggregate }, dirty: false });
      if (result.value.quests.length > 0) await get().loadNodes();
      else await get().loadProjectState();
      return null;
    },
    async createEntity(kind, preset) {
      await get().flushEntities();
      const allocated = await api.allocateIds(kind === 'npc' ? 'creature' : kind === 'object' ? 'gameobject' : 'item', 1);
      if (!allocated.ok) return { error: allocated.error.message };
      const entry = allocated.value[0];
      if (entry === undefined) return { error: 'No free ID could be found.' };
      const now = get().entities;
      const next: ProjectEntities =
        kind === 'npc'
          ? { ...now, npcs: [...now.npcs, { ...newNpc(entry), ...(preset as Partial<CustomNpc>), entry }] }
          : kind === 'object'
            ? { ...now, objects: [...now.objects, { ...newObject(entry), ...(preset as Partial<CustomObject>), entry }] }
            : { ...now, items: [...now.items, { ...newItem(entry), ...(preset as Partial<CustomItem>), entry }] };
      set({ entities: next });
      const sent = await api.putProjectEntities(next);
      if (!sent.ok) {
        await get().loadEntities();
        await get().loadLayer();
        return { error: sent.error.message };
      }
      await get().loadProjectState();
      return { entry };
    },
    async adoptEntity(kind, entry) {
      await get().flushEntities();
      const listOf = (e: ProjectEntities) => (kind === 'npc' ? e.npcs : kind === 'object' ? e.objects : e.items);
      if (listOf(get().entities).some((x) => x.entry === entry)) return { entry };
      const read = await api.readExistingEntity(kind, entry);
      if (!read.ok) return { error: read.error.message };
      const now = get().entities;
      // Read while it was waiting: another adopt may have brought it in meanwhile
      if (listOf(now).some((x) => x.entry === entry)) return { entry };
      const next: ProjectEntities =
        kind === 'npc'
          ? { ...now, npcs: [...now.npcs, read.value as CustomNpc] }
          : kind === 'object'
            ? { ...now, objects: [...now.objects, read.value as CustomObject] }
            : { ...now, items: [...now.items, read.value as CustomItem] };
      set({ entities: next });
      const sent = await api.putProjectEntities(next);
      if (!sent.ok) {
        await get().loadEntities();
        await get().loadLayer();
        return { error: sent.error.message };
      }
      await get().loadProjectState();
      return { entry };
    },
  };
}
