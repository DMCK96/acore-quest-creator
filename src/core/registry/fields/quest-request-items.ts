import type { FieldDef, ListFieldDef, ScalarFieldDef, TableDef } from '../types';

const TABLE = 'quest_request_items';

const scalar = (def: Omit<ScalarFieldDef, 'shape' | 'id' | 'table'>): ScalarFieldDef => ({
  shape: 'scalar',
  id: `${TABLE}.${def.column}`,
  table: TABLE,
  ...def,
});

const scalars: ScalarFieldDef[] = [
  scalar({
    column: 'ID',
    type: { kind: 'int', min: 0 },
    label: 'Quest ID',
    help: 'The quest this row belongs to. It matches quest_template.ID.',
    group: 'identity',
  }),
  scalar({
    column: 'EmoteOnComplete',
    type: { kind: 'idRef', target: 'emote' },
    label: 'Emote when complete',
    help: 'The emote the quest giver plays when the player returns with the quest complete. 0 for none.',
    group: 'story',
    control: 'emote',
  }),
  scalar({
    column: 'EmoteOnIncomplete',
    type: { kind: 'idRef', target: 'emote' },
    label: 'Emote when incomplete',
    help: 'The emote the quest giver plays when the player returns before finishing the quest. 0 for none.',
    group: 'story',
    control: 'emote',
  }),
  scalar({
    column: 'CompletionText',
    type: { kind: 'text' },
    label: 'Progress text',
    help: 'What the quest giver says when the player comes back with the quest not yet handed in. Tokens work here: $N is the player name, $C the class, $R the race, $B a line break, and $G male:female; picks a word by the gender of the player.',
    group: 'story',
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

export const questRequestItemsTable: TableDef = {
  table: TABLE,
  role: 'owned',
  cardinality: 'one',
  keyColumns: ['ID'],
  alwaysEmit: true,
  where: (questId) => ({ ID: String(questId) }),
};

export const questRequestItemsFields: readonly FieldDef[] = scalars;
