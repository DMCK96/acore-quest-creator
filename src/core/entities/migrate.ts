import { ENTITIES_FIELD, readProjectEntities, type ProjectEntities } from './model';

/**
 * Projects before version 4 kept new NPCs, objects and items inside each quest. This moves them into
 * the project's one store: an object's quest-only use and a fight's credit name the quest it came from,
 * and the quests lose the field. Pure: nothing passed in is
 * changed.
 */

type Raw = Record<string, unknown>;
type QuestLike = { questId: number; aggregate: { values: Record<string, unknown> } };

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** A fight with every credit step given the quest it came from, where it names none */
function creditedFight(fight: unknown, questId: number): unknown {
  if (!isRecord(fight) || !Array.isArray(fight.reactions)) return fight;
  return {
    ...fight,
    reactions: fight.reactions.map((reaction) =>
      isRecord(reaction) && Array.isArray(reaction.steps)
        ? { ...reaction, steps: reaction.steps.map((step) => (isRecord(step) && step.kind === 'credit' && typeof step.quest !== 'number' ? { ...step, quest: questId } : step)) }
        : reaction,
    ),
  };
}

function fromQuest(raw: unknown, questId: number): ProjectEntities {
  const record = isRecord(raw) ? raw : {};
  return readProjectEntities({
    npcs: list(record.npcs).map((n) => ({ ...n, fight: creditedFight(n.fight, questId) })),
    objects: list(record.objects).map((o) => ({
      ...o,
      onlyDuringQuest: o.onlyDuringQuest === true ? questId : typeof o.onlyDuringQuest === 'number' ? o.onlyDuringQuest : null,
    })),
    items: list(record.items),
  });
}

export function migrateQuestEntities<Q extends QuestLike>(quests: readonly Q[]): { entities: ProjectEntities; quests: Q[]; warnings: string[] } {
  const entities: ProjectEntities = { npcs: [], objects: [], items: [] };
  const warnings: string[] = [];
  const firstOf = new Map<string, number>();
  for (const quest of [...quests].sort((a, b) => a.questId - b.questId)) {
    const moved = fromQuest(quest.aggregate.values[ENTITIES_FIELD], quest.questId);
    for (const [kind, word] of [['npcs', 'NPC'], ['objects', 'Object'], ['items', 'Item']] as const) {
      for (const entity of moved[kind]) {
        const key = `${kind}:${entity.entry}`;
        const first = firstOf.get(key);
        if (first !== undefined) {
          warnings.push(`${word} ${entity.entry} was in quests ${first} and ${quest.questId}; the one from quest ${first} was kept.`);
          continue;
        }
        firstOf.set(key, quest.questId);
        (entities[kind] as (typeof entity)[]).push(entity);
      }
    }
  }
  const stripped = quests.map((quest) => {
    if (!Object.prototype.hasOwnProperty.call(quest.aggregate.values, ENTITIES_FIELD)) return quest;
    const { [ENTITIES_FIELD]: _gone, ...values } = quest.aggregate.values;
    return { ...quest, aggregate: { ...quest.aggregate, values } };
  });
  return { entities, quests: stripped, warnings };
}
