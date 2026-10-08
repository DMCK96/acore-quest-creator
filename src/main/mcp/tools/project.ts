import { z } from 'zod';
import { defineTool } from '../tool';

/** Connections, the open project and its undo history: the first things a client asks. */
export const projectTools = [
  defineTool({
    name: 'list_profiles',
    title: 'List connection profiles',
    description: 'The saved connections to a world database (name, host, database, last connected). Passwords are never shown. Use connect with a profile id to open one.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('listProfiles'),
  }),
  defineTool({
    name: 'connect',
    title: 'Connect to a world database',
    description: 'Connects the editor to a saved profile (see list_profiles). Call this first when other tools answer NOT_CONNECTED. The database is only ever read.',
    input: { profileId: z.number().int().describe('The id of a profile from list_profiles.') },
    write: false,
    run: async ({ profileId }, ctx) => {
      const connected = await ctx.call('connect', profileId);
      if (connected.ok) ctx.notifyConnected(connected.value);
      return connected;
    },
  }),
  defineTool({
    name: 'project_state',
    title: 'The open project',
    description: 'The open project: its name, whether it has unsaved changes, and the id range its new quests, NPCs, objects and items are given.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('projectState'),
  }),
  defineTool({
    name: 'history_list',
    title: 'Undo history',
    description: 'The project\'s undo history, oldest first. Steps made through this server are labelled "AI: …". Also says which step is current.',
    input: {},
    write: false,
    run: (_args, ctx) => ctx.call('historyList'),
  }),
];
