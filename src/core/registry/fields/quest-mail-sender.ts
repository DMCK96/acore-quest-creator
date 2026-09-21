import type { FieldDef, ListFieldDef, ScalarFieldDef, TableDef } from '../types';

const TABLE = 'quest_mail_sender';

const scalar = (def: Omit<ScalarFieldDef, 'shape' | 'id' | 'table'>): ScalarFieldDef => ({
  shape: 'scalar',
  id: `${TABLE}.${def.column}`,
  table: TABLE,
  ...def,
});

const scalars: ScalarFieldDef[] = [
  scalar({
    column: 'QuestId',
    type: { kind: 'int', min: 0 },
    label: 'Quest ID',
    help: 'The quest this row belongs to. It matches quest_template.ID.',
    group: 'identity',
  }),
  scalar({
    column: 'RewardMailSenderEntry',
    type: { kind: 'idRef', target: 'creature' },
    label: 'Mail sender',
    help: 'The creature shown as the sender of the reward mail. 0 or no row means the quest giver sends it.',
    group: 'rewards',
  }),
];

export const questMailSenderTable: TableDef = {
  table: TABLE,
  role: 'owned',
  cardinality: 'one',
  keyColumns: ['QuestId'],
  where: (questId) => ({ QuestId: String(questId) }),
};

export const questMailSenderFields: readonly FieldDef[] = scalars;
