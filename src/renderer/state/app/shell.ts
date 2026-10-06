import type { SliceArgs } from './types';

/** Which screen shows, the error being shown, and the clock that orders opens */
export interface ShellSlice {
  screen: 'connect' | 'pick' | 'preview' | 'edit';
  /**
   * The moment (on `moment()`'s clock) the action that last opened a quest began; 0 before any. The
   * shell brings the quests forward for it unless the author picked a workspace after that moment, so
   * an open that lands late, or a screen change inside the open quest, never pulls them away.
   */
  questsAsked: number;
  error: string | null;
  /** Now, on the clock `questsAsked` is read against: a later call always gives a larger number. */
  moment(): number;
  dismissError(): void;
}

export function createShellSlice({ kit, set }: SliceArgs): ShellSlice {
  return {
    screen: 'connect',
    questsAsked: 0,
    error: null,
    moment: () => ++kit.clock,
    dismissError() {
      set({ error: null });
    },
  };
}
