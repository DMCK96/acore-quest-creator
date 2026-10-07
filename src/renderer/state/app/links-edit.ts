import type { FieldValue } from '@core/registry/types';
import { checkLink, linkFields, PREV_QUEST_FIELD, prerequisiteRefusal, questLabel } from '@core/links/drag-link';
import type { SliceArgs } from './types';

/** Linking and unlinking quests from the chain graph, each one step of the history */
export interface LinksEditSlice {
  /** Makes turning in `from` unlock `to`; false (with the reason shown) when it was refused or did not land */
  linkQuests(from: number, to: number): Promise<boolean>;
  /** Takes back the turn-in link from `from` to `to`; false when `to` does not unlock after `from` */
  unlinkQuests(from: number, to: number): Promise<boolean>;
}

export function createLinksEditSlice({ set, get }: SliceArgs): LinksEditSlice {
  /**
   * Edits quest `questId` as one step: it is opened when it is not the open quest, `work` makes its
   * edits through `setValue` (false: it made none), and the quest that was open is opened again
   * after, on the screen it was on, still showing why a link was refused. With a quest open the focus
   * stays on it throughout, so the World does not fly to the edited quest and back. True when the
   * edits reached the project; an edit that could not be sent stays open, unsent, with its error.
   */
  async function editQuest(questId: number, label: string, work: (values: Record<string, FieldValue>) => boolean): Promise<boolean> {
    const was = get().open?.questId ?? null;
    const screen = get().screen;
    let switched = false;
    let edited = false;
    await get().historyStep(async () => {
      if (get().open?.questId !== questId) {
        // A failed open shows why, on the quest still open; one another open overtook leaves that one be
        if (!(await get().openQuest(questId, undefined, { working: was !== null }))) return;
        switched = true;
      }
      edited = work(get().open!.aggregate.values);
    }, label, { questId });
    // The step sent the edit and redrew the graph; a failed send is still pending, and is not dropped
    if (edited && get().dirty) return false;
    const error = get().error;
    if (switched && was !== null && (await get().openQuest(was, undefined, { working: true }))) set({ screen, error });
    return edited;
  }

  return {
    async linkQuests(from, to) {
      const { nodes } = get();
      const refusal = checkLink(nodes, from, to);
      if (refusal) {
        set({ error: refusal });
        return false;
      }
      return editQuest(to, `Unlock ${questLabel(nodes, to)} after ${questLabel(nodes, from)}`, (values) => {
        // A prerequisite the graph does not show (a quest not on it) is still one
        const prev = Number(values[PREV_QUEST_FIELD] ?? 0);
        if (prev !== 0 && prev !== from) {
          set({ error: prerequisiteRefusal(nodes, to) });
          return false;
        }
        for (const edit of linkFields(from, to)) get().setValue(edit.fieldId, edit.value);
        return true;
      });
    },
    async unlinkQuests(from, to) {
      const { nodes } = get();
      return editQuest(to, `Remove the link from ${questLabel(nodes, from)} to ${questLabel(nodes, to)}`, (values) => {
        if (Number(values[PREV_QUEST_FIELD] ?? 0) !== from) return false;
        get().setValue(PREV_QUEST_FIELD, 0);
        return true;
      });
    },
  };
}
