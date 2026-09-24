import { describeScene } from './describe';
import { sceneSchema, type QuestScene } from './model';

/**
 * How the tool recognises its own rows in a shared table. Every row it writes starts its comment
 * with `AQC q<quest> <scene>`; the trigger row also carries the whole scene as JSON after ` #aqc=`,
 * so a quest imported into a fresh project gets its scenes back exactly as authored.
 */

const DATA_MARKER = ' #aqc=';

export function sceneTag(questId: number, sceneId: string): string {
  return `AQC q${questId} ${sceneId}`;
}

/** The trailing space stops quest 6000 from claiming quest 60001's rows. */
export function questTagPrefix(questId: number): string {
  return `AQC q${questId} `;
}

export function isOurs(comment: string | null | undefined, questId: number): boolean {
  return typeof comment === 'string' && comment.startsWith(questTagPrefix(questId));
}

/** The scene a tagged row belongs to, or null for a row that is not this quest's. */
export function sceneIdOf(comment: string | null | undefined, questId: number): string | null {
  if (!isOurs(comment, questId)) return null;
  const rest = comment!.slice(questTagPrefix(questId).length);
  const id = rest.split(':', 1)[0]!.trim();
  return /^s\d+$/.test(id) ? id : null;
}

/** The tag on every row of a new NPC's fight (slice I); fight rows are never scene rows. */
export function fightTag(questId: number, entry: number): string {
  return `${questTagPrefix(questId)}fight${entry}`;
}

/** The NPC a fight row belongs to, or null for a row that is not one of this quest's fight rows. */
export function fightEntryOf(comment: string | null | undefined, questId: number): number | null {
  if (!isOurs(comment, questId)) return null;
  const match = /^fight(\d+)(?::|$)/.exec(comment!.slice(questTagPrefix(questId).length));
  return match ? Number(match[1]) : null;
}

export function triggerComment(questId: number, scene: QuestScene): string {
  return `${sceneTag(questId, scene.id)}: ${describeScene(scene)}${DATA_MARKER}${JSON.stringify(scene)}`;
}

/** The scene a trigger row carries, or null when the data is missing or damaged. */
export function sceneFromComment(comment: string | null | undefined): QuestScene | null {
  if (typeof comment !== 'string') return null;
  const at = comment.lastIndexOf(DATA_MARKER);
  if (at < 0) return null;
  try {
    const parsed = sceneSchema.safeParse(JSON.parse(comment.slice(at + DATA_MARKER.length)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
