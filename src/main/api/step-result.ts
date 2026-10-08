import { movementsOf } from '../../core/world/layer';
import type { HistoryList, HistoryResult, StepSummary } from '../../shared/history';
import { describeStep } from '../project/step-labels';
import type { HistoryStep } from '../project/history';
import type { ProjectSession } from '../project/session';

/**
 * What steps changed, as the window needs to hear it: every quest they touched as it now is, whether
 * the canvas's quests or positions moved, the world layer, the project's entities and its name.
 *
 * Used for an undo, redo or jump (the steps were just applied) and for a step made by a tool of the
 * MCP server (the steps stand as `redo`). `skip` holds the parts of a step that were left alone.
 */
export function resultOfSteps(
  session: ProjectSession,
  applied: readonly { step: HistoryStep; skip: ReadonlySet<number> }[],
  direction: 'undo' | 'redo',
  skipped: string[],
  history: HistoryList,
): HistoryResult {
  const touched: number[] = [];
  let positions = false;
  let world = false;
  let entities = false;
  let name = false;
  let last: StepSummary | null = null;
  for (const { step, skip } of applied) {
    step.parts.forEach((part, i) => {
      if (skip.has(i)) return;
      if (part.kind === 'quest') {
        if (!touched.includes(part.questId)) touched.push(part.questId);
        if (part.before === null || part.after === null) positions = true;
      } else if (part.kind === 'positions') positions = true;
      else if (part.kind === 'world') world = true;
      else if (part.kind === 'entities') entities = true;
      else name = true;
    });
    last = { id: step.id, ...describeStep(step) };
  }
  const layer = session.world.get();
  return {
    step: last,
    direction,
    quests: touched.map((questId) => ({ questId, aggregate: session.quests.get(questId)?.aggregate ?? null })),
    positions,
    world: world ? { ...layer, movements: movementsOf(layer) } : null,
    entities: entities ? session.entities.get() : null,
    name,
    skipped,
    history,
  };
}
