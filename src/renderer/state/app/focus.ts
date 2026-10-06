import type { SliceArgs } from './types';

/** A creature or object of the focused quest, picked out in the world */
export interface FocusPart {
  kind: 'creature' | 'gameobject';
  entry: number;
}

/** The one quest (and part of it) every view agrees on: the chain, the editor and the 3D world */
export interface FocusSlice {
  focus: {
    questId: number | null;
    part: FocusPart | null;
    /** Rises on every change of focus, so a view can tell a new focus from a re-render. */
    nonce: number;
    /** The `moment()` of the change that set this focus; 0 before any. */
    at: number;
  };
  /**
   * Moves the focus; asking for the focus already held does nothing, unless it is asked for `again`
   * (Show in World asked twice for the same quest is two requests).
   */
  setFocus(questId: number | null, part?: FocusPart | null, options?: { again?: boolean }): void;
}

export function createFocusSlice({ set, get }: SliceArgs): FocusSlice {
  return {
    focus: { questId: null, part: null, nonce: 0, at: 0 },
    setFocus(questId, part = null, options) {
      const { focus } = get();
      if (!options?.again && focus.questId === questId && focus.part?.kind === part?.kind && focus.part?.entry === part?.entry) return;
      set({ focus: { questId, part, nonce: focus.nonce + 1, at: get().moment() } });
    },
  };
}
