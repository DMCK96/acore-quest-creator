import type { FieldDef, ScalarFieldDef, ScalarType, TableDef } from '../types';

const TABLE = 'quest_template_addon';

const scalar = (def: Omit<ScalarFieldDef, 'shape' | 'id' | 'table'>): ScalarFieldDef => ({
  shape: 'scalar',
  id: `${TABLE}.${def.column}`,
  table: TABLE,
  ...def,
});

/**
 * `QuestSpecialFlags` from the fork's `src/server/game/Quests/QuestDef.h`. Only the bits inside
 * `QUEST_SPECIAL_FLAGS_DB_ALLOWED` (0x001 to 0x100) may be authored; the higher bits are worked out
 * by the server at load time and are listed in the help text instead.
 */
const SPECIAL_FLAGS: ScalarType = {
  kind: 'flags',
  flags: [
    { bit: 0x0001, label: 'Repeatable' },
    { bit: 0x0002, label: 'Completed by exploring an area or by a spell or script' },
    { bit: 0x0004, label: 'Accepted automatically' },
    { bit: 0x0008, label: 'Used by the Dungeon Finder' },
    { bit: 0x0010, label: 'Resets at the start of each month' },
    { bit: 0x0020, label: 'Credit comes from casting a spell, not from a kill' },
    { bit: 0x0040, label: 'Reputation is not shared with allied factions' },
    { bit: 0x0080, label: 'Can be failed at any point' },
    { bit: 0x0100, label: 'Does not count towards Loremaster' },
  ],
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
    column: 'MaxLevel',
    type: { kind: 'int', min: 0 },
    label: 'Maximum player level',
    help: 'The highest level a player can be and still be offered the quest. 0 means no upper limit.',
    group: 'identity',
  }),
  scalar({
    column: 'AllowableClasses',
    type: { kind: 'int', min: 0 },
    label: 'Classes that can take this quest',
    help: 'A bitmask of the classes allowed to take the quest. 0 means every class.',
    group: 'identity',
    control: 'classMask',
  }),

  scalar({
    column: 'SourceSpellID',
    type: { kind: 'idRef', target: 'spell' },
    label: 'Spell cast on accept',
    help: 'A spell cast on the player the moment the quest is accepted, and removed if the quest is abandoned. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'ProvidedItemCount',
    type: { kind: 'int', min: 0 },
    label: 'Quantity of the start item',
    help: 'How many of the quest\'s start item the player is given when accepting it.',
    group: 'availability',
  }),
  scalar({
    column: 'PrevQuestID',
    type: { kind: 'int' },
    label: 'Previous quest',
    help: 'The quest that must come before this one. A positive value means that quest must have been completed and rewarded. A negative value is a quest ID with the sign flipped and means the player only needs to have it active or completed. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'NextQuestID',
    type: { kind: 'int', min: 0 },
    label: 'Next quest in chain',
    help: 'The quest ID this quest unlocks. It is the back-reference used together with the next quest\'s required-previous-quest value. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'ExclusiveGroup',
    type: { kind: 'int' },
    label: 'Exclusive group',
    help: 'Groups this quest with others that share the same number. A positive number means the player may take only one quest of the group. A negative number means every quest of the group must be completed before any quest that depends on the group opens. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'BreadcrumbForQuestId',
    type: { kind: 'idRef', target: 'quest' },
    label: 'Breadcrumb for quest',
    help: 'Marks this quest as a pointer towards another quest: it stops being offered, and is removed from the log, once that quest is taken or completed. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'RequiredSkillID',
    type: { kind: 'idRef', target: 'skill' },
    label: 'Required profession',
    help: 'A skill from SkillLine.dbc the player must have to be offered the quest. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'RequiredSkillPoints',
    type: { kind: 'int', min: 0 },
    label: 'Required skill level',
    help: 'The skill level the player needs in the required profession, for example 225.',
    group: 'availability',
  }),
  scalar({
    column: 'RequiredMinRepFaction',
    type: { kind: 'idRef', target: 'faction' },
    label: 'Faction for the minimum reputation',
    help: 'The faction the player must have at least a given reputation with. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'RequiredMinRepValue',
    type: { kind: 'int' },
    label: 'Minimum reputation',
    help: 'The reputation the player must have reached with that faction, as a raw reputation value.',
    group: 'availability',
  }),
  scalar({
    column: 'RequiredMaxRepFaction',
    type: { kind: 'idRef', target: 'faction' },
    label: 'Faction for the maximum reputation',
    help: 'The faction the player must stay below a given reputation with. 0 for none.',
    group: 'availability',
  }),
  scalar({
    column: 'RequiredMaxRepValue',
    type: { kind: 'int' },
    label: 'Maximum reputation',
    help: 'The reputation the player must not have exceeded with that faction, as a raw reputation value.',
    group: 'availability',
  }),
  scalar({
    column: 'SpecialFlags',
    type: SPECIAL_FLAGS,
    label: 'Server flags',
    help: 'Server-side switches such as repeatable, monthly or auto-accepted. Bits above 256 are worked out by the server from the quest itself and should not be set by hand.',
    group: 'availability',
  }),

  scalar({
    column: 'RewardMailTemplateID',
    type: { kind: 'idRef', target: 'mailTemplate' },
    label: 'Mail sent afterwards',
    help: 'A mail template from MailTemplate.dbc sent to the player after the quest is handed in. 0 for none.',
    group: 'rewards',
  }),
  scalar({
    column: 'RewardMailDelay',
    type: { kind: 'int', min: 0 },
    label: 'Mail delay (seconds)',
    help: 'How long to wait, in seconds, before the reward mail arrives.',
    group: 'rewards',
  }),
];

export const questTemplateAddonTable: TableDef = {
  table: TABLE,
  role: 'owned',
  cardinality: 'one',
  keyColumns: ['ID'],
  alwaysEmit: true,
  where: (questId) => ({ ID: String(questId) }),
};

export const questTemplateAddonFields: readonly FieldDef[] = scalars;
