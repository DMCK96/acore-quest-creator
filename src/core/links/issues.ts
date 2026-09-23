import type { Issue } from '../validate/validate';
import type { LinkSnapshot } from './service';
import { componentById } from './catalog';
import { questEdges } from './model';

/**
 * Validation drawn from the link model rather than a quest's own fields: whether anything actually
 * starts a new quest, whether a script that looks like an offer will ever run, and whether "offered
 * straight away" points at a quest the same turn-in NPC does not also start. `disconnectedQuests` is
 * the canvas-level counterpart, flagging quests that share no edge with anything else drawn.
 */

export const NO_STARTER_MESSAGE =
  'Nothing offers this quest: add a creature or object that starts it, an item that begins it, or a script that offers it.';
export const NOT_CONNECTED_MESSAGE = 'Not connected to any other quest on the canvas.';

/** Every instance's `to` endpoint that is this quest, started by a hook the catalog marks `start`. */
function startsQuest(questId: number, snapshot: LinkSnapshot): boolean {
  return snapshot.result.instances.some(
    (instance) => instance.to.kind === 'quest' && instance.to.questId === questId
      && componentById(instance.component).hook === 'start',
  );
}

export function linkIssues(questId: number, snapshot: LinkSnapshot): Issue[] {
  const issues: Issue[] = [];
  const facts = snapshot.facts.get(questId);

  if (facts?.isNew && !startsQuest(questId, snapshot)) {
    issues.push({
      severity: 'warning',
      code: 'NO_STARTER',
      fieldId: 'creature_queststarter',
      message: NO_STARTER_MESSAGE,
    });
  }

  for (const instance of snapshot.result.instances) {
    if (instance.owner === questId && instance.inactiveReason !== undefined) {
      issues.push({ severity: 'warning', code: 'SCRIPT_WILL_NOT_RUN', message: instance.inactiveReason });
    }
  }

  for (const instance of snapshot.result.instances) {
    if (instance.component !== 'start.offeredStraightAway' || instance.owner !== questId) continue;
    if (instance.to.kind !== 'quest') continue;
    const targetId = instance.to.questId;
    const targetFacts = snapshot.facts.get(targetId);
    if (!targetFacts) continue;
    if (facts === undefined) continue;
    if (facts.creatureEnders.length === 0 && facts.objectEnders.length === 0) continue;
    const startedByEnder =
      facts.creatureEnders.some((id) => targetFacts.creatureStarters.includes(id))
      || facts.objectEnders.some((id) => targetFacts.objectStarters.includes(id));
    if (startedByEnder) continue;
    issues.push({
      severity: 'warning',
      code: 'OFFER_NOT_STARTED_BY_ENDER',
      fieldId: 'quest_template.RewardNextQuest',
      message: `Quest ${targetId} is offered straight away on turn-in, but none of the NPCs or objects that take `
        + `this quest back start it, so nothing is offered.`,
    });
  }

  return issues;
}

export function disconnectedQuests(canvasIds: readonly number[], snapshot: LinkSnapshot): Set<number> {
  if (canvasIds.length < 2) return new Set();
  const canvasSet = new Set(canvasIds);
  const connected = new Set<number>();
  for (const instance of snapshot.result.instances) {
    for (const edge of questEdges(instance)) {
      if (canvasSet.has(edge.from) && canvasSet.has(edge.to)) {
        connected.add(edge.from);
        connected.add(edge.to);
      }
    }
  }
  const disconnected = new Set<number>();
  for (const id of canvasIds) if (!connected.has(id)) disconnected.add(id);
  return disconnected;
}
