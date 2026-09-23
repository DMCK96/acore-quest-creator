import { instanceId, type ComponentInstance, type LinkEdit, type RowRef } from '../model';
import { questName } from '../describe';
import type { ComponentDef, RecogniseInput } from '../component';
import type { QuestFacts } from '../facts';

/**
 * `ExclusiveGroup` is shared across every member: a positive value means "pick one of these quests",
 * a negative value "finish all of these quests before the next one unlocks". Both readings need every
 * member gathered before an instance can be built, unlike the quest-column components that read one
 * quest at a time.
 */

function membersByGroup(facts: ReadonlyMap<number, QuestFacts>): Map<number, QuestFacts[]> {
  const byGroup = new Map<number, QuestFacts[]>();
  for (const f of facts.values()) {
    if (f.exclusiveGroup === 0) continue;
    const list = byGroup.get(f.exclusiveGroup);
    if (list) list.push(f);
    else byGroup.set(f.exclusiveGroup, [f]);
  }
  for (const list of byGroup.values()) list.sort((a, b) => a.questId - b.questId);
  return byGroup;
}

const groupClaim = (questId: number): RowRef => ({ table: 'quest_template_addon', key: `ID=${questId}`, column: 'ExclusiveGroup' });
const nextQuestClaim = (questId: number): RowRef => ({ table: 'quest_template_addon', key: `ID=${questId}`, column: 'NextQuestID' });

const pickOne: ComponentDef = {
  id: 'group.pickOne',
  label: 'Pick one of a group',
  help: 'Pick one of a group',
  hook: 'availability',
  action: 'gateQuest',
  mechanism: 'questColumns',
  params: [
    { name: 'group', label: 'Group', type: { kind: 'int' } },
    { name: 'members', label: 'Members', type: { kind: 'idRef', target: 'quest' } },
    { name: 'then', label: 'Then', type: { kind: 'idRef', target: 'quest' } },
  ],
  requires: [{ table: 'quest_template_addon', columns: ['ExclusiveGroup'] }],
  writable: true,
  recognise(input: RecogniseInput): ComponentInstance[] {
    const instances: ComponentInstance[] = [];
    for (const [group, members] of membersByGroup(input.facts)) {
      if (group <= 0) continue;
      const memberIds = members.map((m) => m.questId);
      const claims = memberIds.map(groupClaim);
      instances.push({
        id: instanceId('group.pickOne', claims),
        component: 'group.pickOne',
        owner: memberIds[0],
        from: { kind: 'group', group },
        to: { kind: 'group', group },
        params: { group, members: memberIds, then: 0 },
        claims,
        editable: true,
      });
    }
    return instances;
  },
  write(params, _target): LinkEdit[] {
    const group = params.group as number;
    const members = params.members as readonly number[];
    const value = Math.abs(group);
    return members.map((questId) => ({ questId, fieldId: 'quest_template_addon.ExclusiveGroup', value }));
  },
  describe(instance, names): string {
    const members = instance.params.members as readonly number[];
    return `Pick one of ${members.map((id) => questName(id, names)).join(', ')}`;
  },
};

const finishAll: ComponentDef = {
  id: 'group.finishAll',
  label: 'Finish all of a group',
  help: 'Finish all of a group',
  hook: 'availability',
  action: 'unlockQuest',
  mechanism: 'questColumns',
  params: [
    { name: 'group', label: 'Group', type: { kind: 'int' } },
    { name: 'members', label: 'Members', type: { kind: 'idRef', target: 'quest' } },
    { name: 'then', label: 'Then', type: { kind: 'idRef', target: 'quest' } },
  ],
  requires: [
    { table: 'quest_template_addon', columns: ['ExclusiveGroup'] },
    { table: 'quest_template_addon', columns: ['NextQuestID'] },
  ],
  writable: true,
  recognise(input: RecogniseInput): ComponentInstance[] {
    const instances: ComponentInstance[] = [];
    for (const [group, members] of membersByGroup(input.facts)) {
      if (group >= 0) continue;
      const memberIds = members.map((m) => m.questId);
      const claims = memberIds.map(groupClaim);
      const nextIds = new Set(members.map((m) => m.nextQuestId));
      const shared = nextIds.size === 1 ? [...nextIds][0] : 0;
      const then = shared > 0 ? shared : 0;
      if (then > 0) claims.push(...memberIds.map(nextQuestClaim));
      instances.push({
        id: instanceId('group.finishAll', claims),
        component: 'group.finishAll',
        owner: memberIds[0],
        from: { kind: 'group', group },
        to: { kind: 'group', group },
        params: { group, members: memberIds, then },
        claims,
        editable: true,
      });
    }
    return instances;
  },
  write(params, _target): LinkEdit[] {
    const group = params.group as number;
    const members = params.members as readonly number[];
    const then = params.then as number;
    const value = -Math.abs(group);
    const edits: LinkEdit[] = [];
    for (const questId of members) {
      edits.push({ questId, fieldId: 'quest_template_addon.ExclusiveGroup', value });
      if (then > 0) edits.push({ questId, fieldId: 'quest_template_addon.NextQuestID', value: then });
    }
    return edits;
  },
  describe(instance, names): string {
    const members = instance.params.members as readonly number[];
    const then = instance.params.then as number;
    const list = members.map((id) => questName(id, names)).join(', ');
    const base = `Finish all of ${list}`;
    return then > 0 ? `${base} to unlock ${questName(then, names)}` : base;
  },
};

export const GROUP_COMPONENTS: readonly ComponentDef[] = [finishAll, pickOne];
