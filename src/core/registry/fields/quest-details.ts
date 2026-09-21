import type { FieldDef, ListFieldDef, ScalarFieldDef, TableDef } from '../types';

const TABLE = 'quest_details';

const scalar = (def: Omit<ScalarFieldDef, 'shape' | 'id' | 'table'>): ScalarFieldDef => ({
  shape: 'scalar',
  id: `${TABLE}.${def.column}`,
  table: TABLE,
  ...def,
});

const list = (def: Omit<ListFieldDef, 'shape' | 'id' | 'table'> & { name: string }): ListFieldDef => {
  const { name, ...rest } = def;
  return { shape: 'list', id: `${TABLE}.${name}`, table: TABLE, ...rest };
};

const scalars: ScalarFieldDef[] = [
  scalar({
    column: 'ID',
    type: { kind: 'int', min: 0 },
    label: 'Quest ID',
    help: 'The quest this row belongs to. It matches quest_template.ID.',
    group: 'identity',
  }),
  scalar({
    column: 'VerifiedBuild',
    type: { kind: 'int' },
    label: 'Verified build',
    help: 'Bookkeeping left by the data sniffer: the client build this row was last checked against. The server ignores it.',
    group: 'identity',
    advanced: true,
  }),
];

const lists: ListFieldDef[] = [
  list({
    name: 'Emotes',
    slots: 4,
    members: [
      { name: 'emote', columnTemplate: 'Emote{n}', type: { kind: 'idRef', target: 'emote' }, label: 'Emote' },
      { name: 'delay', columnTemplate: 'EmoteDelay{n}', type: { kind: 'int', min: 0 }, label: 'Delay (ms)' },
    ],
    label: 'Emotes',
    help: 'The emotes the quest giver plays while the offer text is shown. Each slot plays an emote after a delay in milliseconds. Empty slots have emote 0.',
    group: 'story',
    control: 'emote',
  }),
];

export const questDetailsTable: TableDef = {
  table: TABLE,
  role: 'owned',
  cardinality: 'one',
  keyColumns: ['ID'],
  where: (questId) => ({ ID: String(questId) }),
};

export const questDetailsFields: readonly FieldDef[] = [...scalars, ...lists];
