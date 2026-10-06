import type { HistoryList, HistoryResult, StepPlace } from '../history';
import type { Result } from './result';

/** The project history: listing, undoing, redoing, jumping and grouping changes into one step */
export interface HistoryApi {
  /** The project's undo history: its steps, the last one applied, and the saved one. */
  historyList(): Promise<Result<HistoryList>>;
  /** Puts the last step back as it was before it, and says what changed. */
  historyUndo(): Promise<Result<HistoryResult>>;
  /** Does the last undone step again, and says what changed. */
  historyRedo(): Promise<Result<HistoryResult>>;
  /** Undoes or redoes to stand just after a step (0: before every step), and says what changed. */
  historyJump(stepId: number): Promise<Result<HistoryResult>>;
  /** Opens a step: every change until its end is one undo step, with this name and place when given. */
  historyBegin(label?: string, where?: StepPlace): Promise<Result<number>>;
  historyEnd(token: number): Promise<Result<true>>;
}
