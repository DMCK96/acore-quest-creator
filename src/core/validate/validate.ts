import type { RefKind } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { QuestAggregate } from '../model/aggregate';
import type { CreatureOrGoValue, FieldValue } from '../registry/types';

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  fieldId?: string;
  message: string;
}

export interface RefChecker {
  exists(kind: RefKind, id: number): Promise<boolean>;
  /**
   * `true` when the creature's `npcflag` includes the quest-giver bit, or the object's `type` is
   * `GAMEOBJECT_TYPE_QUESTGIVER`; `null` when the entry does not exist (or its table is absent).
   */
  questGiver(kind: 'creature' | 'gameobject', id: number): Promise<boolean | null>;
}

const UNIT_NPC_FLAG_QUESTGIVER = 2n;
const GAMEOBJECT_TYPE_QUESTGIVER = 2n;

const QUEST_GIVER_SOURCE = {
  creature: { table: 'creature_template', column: 'npcflag' },
  gameobject: { table: 'gameobject_template', column: 'type' },
} as const;

/** Reference checks against the world DB, remembering every answer so a form re-validates cheaply. */
export function refCheckerFor(db: WorldDb): RefChecker {
  const existsCache = new Map<string, Promise<boolean>>();
  const giverCache = new Map<string, Promise<boolean | null>>();

  async function lookupGiver(kind: 'creature' | 'gameobject', id: number): Promise<boolean | null> {
    const { table, column } = QUEST_GIVER_SOURCE[kind];
    // A fork without the template table cannot say either way; report "unknown", not a crash.
    if ((await db.columns(table)).length === 0) return null;
    const rows = await db.selectRows(table, { entry: [String(id)] });
    if (rows.length === 0) return null;
    const raw = rows[0][column];
    if (raw === null || !/^-?\d+$/.test(raw)) return false;
    const value = BigInt(raw);
    return kind === 'creature' ? (value & UNIT_NPC_FLAG_QUESTGIVER) !== 0n : value === GAMEOBJECT_TYPE_QUESTGIVER;
  }

  return {
    exists(kind, id) {
      const key = `${kind}:${id}`;
      let hit = existsCache.get(key);
      if (!hit) {
        hit = db.existingIds(kind, [id]).then((found) => found.has(id));
        existsCache.set(key, hit);
      }
      return hit;
    },
    questGiver(kind, id) {
      const key = `${kind}:${id}`;
      let hit = giverCache.get(key);
      if (!hit) {
        hit = lookupGiver(kind, id);
        giverCache.set(key, hit);
      }
      return hit;
    },
  };
}

const F = {
  title: 'quest_template.LogTitle',
  level: 'quest_template.QuestLevel',
  minLevel: 'quest_template.MinLevel',
  startItem: 'quest_template.StartItem',
  rewardItems: 'quest_template.RewardItems',
  choiceItems: 'quest_template.RewardChoiceItems',
  requiredItems: 'quest_template.RequiredItems',
  requiredTargets: 'quest_template.RequiredNpcOrGo',
  prev: 'quest_template_addon.PrevQuestID',
  next: 'quest_template_addon.NextQuestID',
  breadcrumb: 'quest_template_addon.BreadcrumbForQuestId',
  creatureStarter: 'creature_queststarter',
  objectStarter: 'gameobject_queststarter',
  creatureEnder: 'creature_questender',
  objectEnder: 'gameobject_questender',
  triggerEnder: 'areatrigger_involvedrelation',
} as const;

type Row = Record<string, unknown>;

/** Row-shaped value (list or rowset) as plain objects; empty when the field is absent or not row-shaped. */
function rowsOf(values: Record<string, FieldValue>, id: string): Row[] {
  const v = values[id];
  return Array.isArray(v) ? (v as Row[]) : [];
}

/** A number field; `undefined` when the field is absent or not numeric, so its rule is skipped. */
function numberOf(values: Record<string, FieldValue>, id: string): number | undefined {
  const v = values[id];
  return typeof v === 'number' ? v : undefined;
}

const isTarget = (v: unknown): v is CreatureOrGoValue =>
  typeof v === 'object' && v !== null && 'target' in v && 'id' in v;

/**
 * Checks a quest against the conditions the server logs as errors at load (ObjectMgr::LoadQuests and the
 * quest relation loaders), plus a few editor-side sanity warnings. Rules skip fields absent from
 * `aggregate.values`, which are read-only or drifted and cannot be judged.
 */
export async function validateQuest(aggregate: QuestAggregate, refs: RefChecker): Promise<Issue[]> {
  const { values, questId } = aggregate;
  const issues: Issue[] = [];
  const has = (id: string) => id in values;

  // Title
  if (has(F.title)) {
    const title = values[F.title];
    if (typeof title !== 'string' || title.trim() === '') {
      issues.push({ severity: 'error', code: 'NO_TITLE', fieldId: F.title, message: 'The quest needs a title.' });
    }
  }

  // Quest chain. The server takes std::abs() of PrevQuestID only; NextQuestID and
  // BreadcrumbForQuestId are unsigned there, so a plain lookup is the same thing.
  const chain: Array<{ id: string; code: string; label: string; abs: boolean }> = [
    { id: F.prev, code: 'DANGLING_PREV', label: 'Previous quest', abs: true },
    { id: F.next, code: 'DANGLING_NEXT', label: 'Next quest', abs: false },
    { id: F.breadcrumb, code: 'DANGLING_BREADCRUMB', label: 'Breadcrumb target quest', abs: false },
  ];
  for (const { id, code, label, abs } of chain) {
    const raw = numberOf(values, id);
    if (raw === undefined || raw === 0) continue;
    const target = abs ? Math.abs(raw) : raw;
    if (target === questId) continue;
    if (!(await refs.exists('quest', target))) {
      issues.push({ severity: 'error', code, fieldId: id, message: `${label} ${target} does not exist.` });
    }
  }

  // Starters and enders
  const creatureStarters = rowsOf(values, F.creatureStarter);
  const objectStarters = rowsOf(values, F.objectStarter);
  const creatureEnders = rowsOf(values, F.creatureEnder);
  const objectEnders = rowsOf(values, F.objectEnder);
  const triggerEnders = rowsOf(values, F.triggerEnder);

  if (has(F.creatureStarter) || has(F.objectStarter)) {
    const startItem = numberOf(values, F.startItem) ?? 0;
    if (creatureStarters.length === 0 && objectStarters.length === 0 && startItem === 0) {
      issues.push({
        severity: 'warning',
        code: 'NO_STARTER',
        fieldId: F.creatureStarter,
        message: 'Nothing offers this quest: add a creature or object that starts it, or a starting item.',
      });
    }
  }
  if (has(F.creatureEnder) || has(F.objectEnder) || has(F.triggerEnder)) {
    if (creatureEnders.length === 0 && objectEnders.length === 0 && triggerEnders.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'NO_ENDER',
        fieldId: F.creatureEnder,
        message: 'Nothing takes this quest back: add a creature, object or area trigger that completes it.',
      });
    }
  }

  // References that should exist
  const missing = async (kind: 'item' | 'creature' | 'gameobject', id: unknown, fieldId: string) => {
    if (typeof id !== 'number' || id === 0) return;
    if (await refs.exists(kind, id)) return;
    const [code, noun] =
      kind === 'item'
        ? ['MISSING_ITEM', 'Item']
        : kind === 'creature'
          ? ['MISSING_CREATURE', 'Creature']
          : ['MISSING_GAMEOBJECT', 'Object'];
    issues.push({ severity: 'warning', code, fieldId, message: `${noun} ${id} does not exist in the world database.` });
  };

  const startItem = numberOf(values, F.startItem);
  if (startItem !== undefined) await missing('item', startItem, F.startItem);
  for (const [fieldId, member] of [
    [F.rewardItems, 'item'],
    [F.choiceItems, 'item'],
    [F.requiredItems, 'item'],
  ] as const) {
    for (const row of rowsOf(values, fieldId)) await missing('item', row[member], fieldId);
  }
  for (const row of rowsOf(values, F.requiredTargets)) {
    const t = row.target;
    if (isTarget(t)) await missing(t.target, t.id, F.requiredTargets);
  }
  for (const [fieldId, kind] of [
    [F.creatureStarter, 'creature'],
    [F.creatureEnder, 'creature'],
    [F.objectStarter, 'gameobject'],
    [F.objectEnder, 'gameobject'],
  ] as const) {
    for (const row of rowsOf(values, fieldId)) await missing(kind, row.id, fieldId);
  }

  // The server logs an error for an object relation whose object is not a quest-giver type, and the
  // object then does nothing for the quest. Creatures are not flagged: the exported patch sets their flag.
  for (const [fieldId, verb] of [
    [F.objectStarter, 'offered'],
    [F.objectEnder, 'turned in'],
  ] as const) {
    for (const row of rowsOf(values, fieldId)) {
      const id = row.id;
      if (typeof id !== 'number' || id === 0) continue;
      if ((await refs.questGiver('gameobject', id)) === false) {
        issues.push({
          severity: 'warning',
          code: 'NOT_QUESTGIVER',
          fieldId,
          message: `Object ${id} is not a quest giver object, so the server logs an error for it and the quest will never be ${verb} there.`,
        });
      }
    }
  }

  // Levels
  const level = numberOf(values, F.level);
  const minLevel = numberOf(values, F.minLevel);
  if (level !== undefined && minLevel !== undefined && level > 0 && minLevel > level) {
    issues.push({
      severity: 'warning',
      code: 'MIN_LEVEL_ABOVE_LEVEL',
      fieldId: F.minLevel,
      message: `Minimum level ${minLevel} is above the quest level ${level}.`,
    });
  }

  return issues;
}
