import type { FieldValue } from '@core/registry/types';
import type { GroupCheck, GroupMove } from '@shared/ipc';
import type { SpawnGroup } from '@core/world/groups';
import type { QuestAggregate } from '@core/model/aggregate';
import type { SliceArgs } from './types';

/** quest_template.Flags, and its bits for a quest offered again each day or each week */
const FLAGS_FIELD = 'quest_template.Flags';
const QUEST_FLAG_DAILY = 0x1000;
const QUEST_FLAG_WEEKLY = 0x8000;

/** Quest rotations (quest pools): making, reading, checking, saving and deleting them */
export interface RotationsSlice {
  /**
   * Saves a quest rotation as one step: first each of its quests not of `makeKind` is made it (that bit
   * set, the other cleared) through the quest's own edit, then the rotation itself. False when it was
   * refused (the reason is in `error`)
   */
  saveRotation(group: SpawnGroup, moves: GroupMove[], makeKind: 'daily' | 'weekly' | null): Promise<boolean>;
  /** A new rotation of these quests, one offered each reset, with a free id; null when no id could be had */
  newRotation(questIds: number[]): Promise<SpawnGroup | null>;
  /** A rotation as the world layer has it, else as the database does; null when it is not there */
  readRotation(id: number): Promise<SpawnGroup | null>;
  /** Why a rotation cannot be saved as it stands, with `moves` taking its quests out of other rotations */
  checkRotation(group: SpawnGroup, moves: GroupMove[]): Promise<GroupCheck>;
  /** Deletes a quest rotation as one step; false when it was refused */
  deleteRotation(id: number, name?: string): Promise<boolean>;
}

export function createRotationsSlice({ api, kit, set, get }: SliceArgs): RotationsSlice {
  return {
    async saveRotation(group, moves, makeKind) {
      let saved = false;
      await get().historyStep(async () => {
        // The flags changed for the save, each with what it was: a refused save puts them back, so it leaves no step
        const madeOpen: { questId: number; was: FieldValue }[] = [];
        const madeOthers: QuestAggregate[] = [];
        const putBack = async (): Promise<void> => {
          for (const aggregate of madeOthers.reverse()) await api.updateQuest(aggregate);
          for (const { questId, was } of madeOpen) if (get().open?.questId === questId) get().setValue(FLAGS_FIELD, was);
        };
        const refuse = async (message: string): Promise<void> => {
          await putBack();
          set({ error: message });
        };
        if (makeKind) {
          const [set1, clear] = makeKind === 'daily' ? [QUEST_FLAG_DAILY, QUEST_FLAG_WEEKLY] : [QUEST_FLAG_WEEKLY, QUEST_FLAG_DAILY];
          const remade = (flags: unknown): number | null => {
            const was = Number(flags ?? 0) || 0;
            const now = (was | set1) & ~clear;
            return now === was ? null : now;
          };
          for (const member of group.members) {
            if (member.type !== 'quest') continue;
            const open = get().open;
            if (open?.questId === member.questId) {
              const was = open.aggregate.values[FLAGS_FIELD];
              const now = remade(was);
              if (now !== null) {
                madeOpen.push({ questId: open.questId, was });
                get().setValue(FLAGS_FIELD, now);
              }
              continue;
            }
            // Only a quest of the project is edited; one only the database has keeps its flags
            if (!get().nodes.some((n) => n.questId === member.questId)) continue;
            const read = await api.openQuest(member.questId);
            if (!read.ok) return refuse(read.error.message);
            const aggregate = read.value.aggregate;
            const now = remade(aggregate.values[FLAGS_FIELD]);
            if (now === null) continue;
            const put = await api.updateQuest({ ...aggregate, values: { ...aggregate.values, [FLAGS_FIELD]: now } });
            if (!put.ok) return refuse(put.error.message);
            madeOthers.push(aggregate);
          }
          // The open quest's edit goes now, so it is in this step before the rotation is checked
          await get().flushSave();
        }
        const result = await api.worldSetGroup(group, moves);
        if (!result.ok) return refuse(result.error.message);
        saved = true;
        set({ worldLayer: { layer: result.value, seq: ++kit.layerSeq }, layer: result.value });
      }, `Saved rotation ${group.name || group.id}`);
      await get().loadNodes();
      return saved;
    },
    async newRotation(questIds) {
      const id = await api.worldNewGroupId();
      if (!id.ok) {
        set({ error: id.error.message });
        return null;
      }
      return { id: id.value, name: '', map: 0, maxActive: 1, members: questIds.map((questId) => ({ type: 'quest' as const, questId })), origin: { kind: 'new' }, event: null };
    },
    async readRotation(id) {
      const found = await api.worldGroup(id);
      if (!found.ok) {
        set({ error: found.error.message });
        return null;
      }
      if (!found.value) set({ error: 'That rotation is no longer there.' });
      return found.value;
    },
    async checkRotation(group, moves) {
      const found = await api.worldCheckGroup(group, moves);
      if (!found.ok) throw new Error(found.error.message);
      return found.value;
    },
    async deleteRotation(id, name) {
      let deleted = false;
      await get().historyStep(async () => {
        const result = await api.worldDeleteGroup(id);
        if (!result.ok) {
          set({ error: result.error.message });
          return;
        }
        deleted = true;
        set({ worldLayer: { layer: result.value, seq: ++kit.layerSeq }, layer: result.value });
      }, `Deleted rotation ${name || id}`);
      await get().loadQuestPools();
      return deleted;
    },
  };
}
