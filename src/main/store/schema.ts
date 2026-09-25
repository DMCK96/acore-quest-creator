import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const connectionProfiles = sqliteTable('connection_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  role: text('role', { enum: ['world', 'dev'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  user: text('user').notNull(),
  database: text('database').notNull(),
  passwordEnc: blob('password_enc', { mode: 'buffer' }).notNull(),
  dbcDir: text('dbc_dir').notNull().default(''),
  clientDir: text('client_dir').notNull().default(''),
  exportDir: text('export_dir').notNull().default(''),
  lastConnectedAt: text('last_connected_at'),
  // A hash of the `.env` values this profile was last seeded from; null for one the user made.
  envSeed: text('env_seed'),
});

/** Project files the user opened or saved lately, newest first by `openedAt`; the files hold the work. */
export const recentProjects = sqliteTable('recent_projects', {
  path: text('path').primaryKey(),
  name: text('name').notNull(),
  openedAt: text('opened_at').notNull(),
});
