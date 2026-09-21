import type { FieldDef, RowSetColumn, RowSetFieldDef, TableDef } from '../types';

/**
 * The map markers of a quest: `quest_poi` holds one area or objective marker, `quest_poi_points`
 * the outline points of each. Both are keyed by the quest, which is `questColumn` and never part of
 * the decoded value, so a quest being copied or created picks up its own ID on export.
 */

const int = (name: string, label: string): RowSetColumn => ({ name, type: { kind: 'int' }, label });

export const questPoiField: RowSetFieldDef = {
  shape: 'rowset',
  id: 'quest_poi',
  table: 'quest_poi',
  columns: [
    int('id', 'Marker'),
    int('ObjectiveIndex', 'Objective'),
    int('MapID', 'Map'),
    int('WorldMapAreaId', 'World map area'),
    int('Floor', 'Floor'),
    int('Priority', 'Priority'),
    int('Flags', 'Flags'),
    int('VerifiedBuild', 'Verified build'),
  ],
  questColumn: 'QuestID',
  label: 'Map markers',
  help: 'Where the quest shows on the world map. Each marker is drawn from the outline points below.',
  group: 'map',
  control: 'poi',
};

export const questPoiPointsField: RowSetFieldDef = {
  shape: 'rowset',
  id: 'quest_poi_points',
  table: 'quest_poi_points',
  columns: [
    int('Idx1', 'Marker'),
    int('Idx2', 'Point'),
    int('X', 'X'),
    int('Y', 'Y'),
    int('VerifiedBuild', 'Verified build'),
  ],
  questColumn: 'QuestID',
  label: 'Map marker points',
  help: 'The outline points of each map marker. Marker is the marker number, Point the order along its outline.',
  group: 'map',
  control: 'poi',
};

export const poiTables: readonly TableDef[] = [
  {
    table: 'quest_poi',
    role: 'owned',
    cardinality: 'many',
    keyColumns: ['QuestID', 'id'],
    where: (questId) => ({ QuestID: String(questId) }),
  },
  {
    table: 'quest_poi_points',
    role: 'owned',
    cardinality: 'many',
    keyColumns: ['QuestID', 'Idx1', 'Idx2'],
    where: (questId) => ({ QuestID: String(questId) }),
  },
];

export const poiFields: readonly FieldDef[] = [questPoiField, questPoiPointsField];
