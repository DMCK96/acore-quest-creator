import { blob, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const connectionProfiles = sqliteTable('connection_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  role: text('role', { enum: ['world', 'dev'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  user: text('user').notNull(),
  database: text('database').notNull(),
  passwordEnc: blob('password_enc', { mode: 'buffer' }).notNull(),
});

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  idRangeStart: integer('id_range_start').notNull(),
  idRangeEnd: integer('id_range_end').notNull(),
  outputDir: text('output_dir').notNull(),
  viewport: text('viewport').notNull().default('{"x":0,"y":0,"zoom":1}'),
});

export const drafts = sqliteTable(
  'drafts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    questId: integer('quest_id').notNull(),
    isNew: integer('is_new', { mode: 'boolean' }).notNull(),
    aggregate: text('aggregate').notNull(),
    snapshot: text('snapshot'),
    fidelity: text('fidelity'),
    x: real('x').notNull().default(0),
    y: real('y').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
    lastExportPath: text('last_export_path'),
  },
  (t) => [uniqueIndex('drafts_project_quest_uq').on(t.projectId, t.questId)],
);
