import type { Api } from './ipc';

/**
 * The method names and channel names, with no runtime dependencies at all.
 *
 * This sits apart from `ipc.ts` because the preload imports it: a sandboxed preload script cannot
 * `require` anything from `node_modules`, so it must not reach code that pulls zod in. Everything
 * else should import these from `@shared/ipc`, which re-exports them.
 */

/** Every method the bridge exposes, in `Api` declaration order. */
export const API_METHODS = [
  'testConnection',
  'saveProfile',
  'listProfiles',
  'startupProfile',
  'connect',
  'searchQuests',
  'openQuest',
  'newQuest',
  'addQuestChain',
  'listNodes',
  'moveNodes',
  'removeNode',
  'saveViewport',
  'lookupNames',
  'questLinks',
  'rewardTables',
  'updateQuest',
  'previewChanges',
  'validate',
  'exportQuest',
  'applyToDev',
  'projectState',
] as const satisfies readonly (keyof Api)[];

/** Fails to compile if `Api` gains or loses a method that this list does not follow. */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _everyMethodIsListed: Exactly<(typeof API_METHODS)[number], keyof Api> = true;
void _everyMethodIsListed;

/** The IPC channel one method answers on. */
export const channelFor = (method: keyof Api): string => `api:${method}`;
