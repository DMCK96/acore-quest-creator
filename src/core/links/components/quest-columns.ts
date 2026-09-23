import { instanceId, type ComponentInstance, type LinkEdit, type RowRef } from '../model';
import { capitalise, questName } from '../describe';
import type { ComponentDef, RecogniseInput } from '../component';

/**
 * The five components read straight off `quest_template`/`quest_template_addon` chain columns: each
 * quest holds at most one value per column, so recognition is a single pass over the facts map with
 * no cross-referencing required.
 */

interface ColumnSpec {
  id: ComponentDef['id'];
  label: string;
  hook: ComponentDef['hook'];
  action: ComponentDef['action'];
  table: string;
  column: string;
  read(prevQuestId: number, nextQuestId: number, rewardNextQuest: number, breadcrumbFor: number): number;
  describe(from: string, to: string): string;
}

const SPECS: readonly ColumnSpec[] = [
  {
    id: 'unlock.afterTurnIn', label: 'Unlocks after turn-in', hook: 'availability', action: 'unlockQuest',
    table: 'quest_template_addon', column: 'PrevQuestID',
    read: (prev) => (prev > 0 ? prev : 0),
    describe: (from, to) => `Turning in ${from} unlocks ${to}`,
  },
  {
    id: 'unlock.whileInLog', label: 'Unlocks while in log', hook: 'availability', action: 'unlockQuest',
    table: 'quest_template_addon', column: 'PrevQuestID',
    read: (prev) => (prev < 0 ? Math.abs(prev) : 0),
    describe: (from, to) => `Having ${from} in the quest log unlocks ${to}`,
  },
  {
    id: 'unlock.nextQuest', label: 'Unlocks next quest', hook: 'availability', action: 'unlockQuest',
    table: 'quest_template_addon', column: 'NextQuestID',
    read: (_prev, next) => next,
    describe: (from, to) => `Turning in ${from} unlocks ${to} (set on ${from})`,
  },
  {
    id: 'start.offeredStraightAway', label: 'Offered straight away', hook: 'start', action: 'offerQuest',
    table: 'quest_template', column: 'RewardNextQuest',
    read: (_prev, _next, reward) => reward,
    describe: (from, to) => `Turning in ${from} offers ${to} straight away`,
  },
  {
    id: 'gate.breadcrumb', label: 'Breadcrumb', hook: 'availability', action: 'gateQuest',
    table: 'quest_template_addon', column: 'BreadcrumbForQuestId',
    read: (_prev, _next, _reward, breadcrumb) => breadcrumb,
    describe: (from, to) => `${capitalise(from)} is a breadcrumb leading to ${to}`,
  },
];

function makeComponent(spec: ColumnSpec): ComponentDef {
  return {
    id: spec.id,
    label: spec.label,
    help: spec.label,
    hook: spec.hook,
    action: spec.action,
    mechanism: 'questColumns',
    params: [
      { name: 'from', label: 'From quest', type: { kind: 'idRef', target: 'quest' } },
      { name: 'to', label: 'To quest', type: { kind: 'idRef', target: 'quest' } },
    ],
    requires: [{ table: spec.table, columns: [spec.column] }],
    writable: true,
    recognise(input: RecogniseInput): ComponentInstance[] {
      const instances: ComponentInstance[] = [];
      for (const facts of input.facts.values()) {
        const owner = facts.questId;
        const target = spec.read(facts.prevQuestId, facts.nextQuestId, facts.rewardNextQuest, facts.breadcrumbFor);
        if (target <= 0 || target === owner) continue;
        const isPrevColumn = spec.column === 'PrevQuestID';
        const from = isPrevColumn ? target : owner;
        const to = isPrevColumn ? owner : target;
        const claim: RowRef = { table: spec.table, key: `ID=${owner}`, column: spec.column };
        instances.push({
          id: instanceId(spec.id, [claim]),
          component: spec.id,
          owner,
          from: { kind: 'quest', questId: from },
          to: { kind: 'quest', questId: to },
          params: { from, to },
          claims: [claim],
          editable: true,
        });
      }
      return instances;
    },
    write(params, _target): LinkEdit[] {
      const from = params.from as number;
      const to = params.to as number;
      const isPrevColumn = spec.column === 'PrevQuestID';
      const owner = isPrevColumn ? to : from;
      const value = spec.column === 'PrevQuestID' && spec.id === 'unlock.whileInLog' ? -from
        : spec.column === 'PrevQuestID' ? from
        : to;
      return [{ questId: owner, fieldId: `${spec.table}.${spec.column}`, value }];
    },
    describe(instance, names): string {
      const from = questName((instance.from as { questId: number }).questId, names);
      const to = questName((instance.to as { questId: number }).questId, names);
      return spec.describe(from, to);
    },
  };
}

export const QUEST_COLUMN_COMPONENTS: readonly ComponentDef[] = SPECS.map(makeComponent);
