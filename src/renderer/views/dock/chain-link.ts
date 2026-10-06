import type { CanvasNode } from '@shared/ipc';
import type { ComponentId } from '@core/links/model';

/**
 * Linking quests by dragging between them on the chain graph. A drag makes only the plainest link,
 * "turning in one unlocks the other" (`PrevQuestID` on the later quest); every other kind stays in
 * the quest editor's Availability tab.
 */
export type LinkKind = 'unlock.afterTurnIn';

/** The one kind of link the graph makes and takes away itself */
export const DRAG_LINK: LinkKind = 'unlock.afterTurnIn';

/** The column a turn-in link is written to, on the quest it unlocks */
export const PREV_QUEST_FIELD = 'quest_template_addon.PrevQuestID';

/** Links that already say one quest follows the other */
const FOLLOWS: readonly ComponentId[] = ['unlock.afterTurnIn', 'unlock.nextQuest', 'unlock.whileInLog'];
/** Links held in the target's `PrevQuestID`, which a turn-in link would overwrite */
const PREREQUISITES: readonly ComponentId[] = ['unlock.afterTurnIn', 'unlock.whileInLog'];

/** The edits that make `from` unlock `to` on turn-in */
export function linkFields(from: number, to: number): { questId: number; fieldId: string; value: number }[] {
  return [{ questId: to, fieldId: PREV_QUEST_FIELD, value: from }];
}

/** A quest as a step label or message names it: its title, else its id */
export function questLabel(nodes: readonly CanvasNode[], questId: number): string {
  return nodes.find((n) => n.questId === questId)?.title.trim() || `Quest ${questId}`;
}

/** The message a target with another prerequisite is refused with */
export const prerequisiteRefusal = (nodes: readonly CanvasNode[], to: number): string =>
  `${questLabel(nodes, to)} already unlocks after another quest; change it in the quest editor.`;

/** Why `from` cannot be made to unlock `to` on turn-in, judged from the graph; null when it can */
export function checkLink(nodes: readonly CanvasNode[], from: number, to: number): string | null {
  if (from === to) return 'A quest cannot lead to itself.';
  const links = (a: number, b: number, kinds: readonly ComponentId[]): boolean =>
    nodes.some((n) => n.questId === a && n.links.some((l) => l.to === b && kinds.includes(l.component)));
  if (links(from, to, FOLLOWS) || links(to, from, FOLLOWS)) return 'These quests are already linked.';
  if (nodes.some((n) => n.links.some((l) => l.to === to && PREREQUISITES.includes(l.component)))) {
    return prerequisiteRefusal(nodes, to);
  }
  return null;
}
