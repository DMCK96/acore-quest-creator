import { describe, expect, it } from 'vitest';
import { checkLink, linkFields, type LinkNode } from '../../src/core/links/drag-link';

/** A quest on the graph, untitled and unlinked unless told */
const nodeOf = (over: Partial<LinkNode> & { questId: number }): LinkNode => ({ title: '', links: [], ...over });

describe('chain links', () => {
  it('a turn-in link sets PrevQuestID on the target', () => {
    expect(linkFields(10, 11)).toEqual([{ questId: 11, fieldId: 'quest_template_addon.PrevQuestID', value: 10 }]);
  });

  it('refuses a quest linking to itself', () => {
    expect(checkLink([nodeOf({ questId: 10 })], 10, 10)).toBe('A quest cannot lead to itself.');
  });

  it('refuses a link that exists, either way', () => {
    const a = nodeOf({ questId: 10, links: [{ to: 11, component: 'unlock.afterTurnIn' }] });
    const b = nodeOf({ questId: 11 });
    expect(checkLink([a, b], 10, 11)).toBe('These quests are already linked.');
    expect(checkLink([a, b], 11, 10)).toBe('These quests are already linked.');
  });

  it('counts a next-quest or while-in-log link as a link too', () => {
    for (const component of ['unlock.nextQuest', 'unlock.whileInLog'] as const) {
      const a = nodeOf({ questId: 10, links: [{ to: 11, component }] });
      const b = nodeOf({ questId: 11 });
      expect(checkLink([a, b], 10, 11)).toBe('These quests are already linked.');
      expect(checkLink([a, b], 11, 10)).toBe('These quests are already linked.');
    }
  });

  it('refuses a target that already unlocks after a different quest', () => {
    const a = nodeOf({ questId: 10, links: [{ to: 12, component: 'unlock.afterTurnIn' }] });
    const b = nodeOf({ questId: 11 });
    const c = nodeOf({ questId: 12, title: 'Bears' });
    expect(checkLink([a, b, c], 11, 12)).toBe('Bears already unlocks after another quest; change it in the quest editor.');
    // Unlocking while another quest is in the log is the same column, so it is a prerequisite too
    const d = nodeOf({ questId: 10, links: [{ to: 12, component: 'unlock.whileInLog' }] });
    expect(checkLink([d, b, c], 11, 12)).toBe('Bears already unlocks after another quest; change it in the quest editor.');
  });

  it('refuses a link that would close a loop, naming its quests', () => {
    const a = nodeOf({ questId: 10, title: 'Wolves', links: [{ to: 11, component: 'unlock.afterTurnIn' }] });
    const b = nodeOf({ questId: 11, title: 'Bears', links: [{ to: 12, component: 'unlock.afterTurnIn' }] });
    const c = nodeOf({ questId: 12, title: 'Boars' });
    expect(checkLink([a, b, c], 12, 10)).toBe('This would make a loop: Wolves → Bears → Boars → Wolves.');
    // A chain that does not come back round is still fine
    expect(checkLink([a, b, c, nodeOf({ questId: 13 })], 12, 13)).toBeNull();
  });

  it('allows a new link between unlinked quests', () => {
    expect(checkLink([nodeOf({ questId: 10 }), nodeOf({ questId: 11 })], 10, 11)).toBeNull();
  });
});
