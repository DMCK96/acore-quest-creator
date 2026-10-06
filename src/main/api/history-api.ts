import type { Api } from '../../shared/ipc';
import type { Services } from './services';
import { run } from './errors';

/** The project history: listing, undoing, redoing, jumping and grouping changes into one step */
export function createHistoryApi(s: Services): Pick<Api, 'historyList' | 'historyUndo' | 'historyRedo' | 'historyJump' | 'historyBegin' | 'historyEnd'> {
  const { history, historyList } = s.ctx;
  const { travel, queued } = s.travel;

  return {
    historyList: () => run(async () => historyList()),

    historyUndo: () =>
      run(() =>
        queued(() =>
          travel(
            () => ({ direction: 'undo', steps: history.peekUndo() ? [history.peekUndo()!] : [] }),
            () => {
              const step = history.undo();
              return { direction: 'undo', steps: step ? [step] : [] };
            },
          ),
        ),
      ),

    historyRedo: () =>
      run(() =>
        queued(() =>
          travel(
            () => ({ direction: 'redo', steps: history.peekRedo() ? [history.peekRedo()!] : [] }),
            () => {
              const step = history.redo();
              return { direction: 'redo', steps: step ? [step] : [] };
            },
          ),
        ),
      ),

    historyJump: (stepId) => run(() => queued(() => travel(() => history.peekJump(stepId), () => history.jump(stepId)))),

    historyBegin: (label, where) => run(async () => history.begin(label, where)),

    historyEnd: (token) =>
      run(async () => {
        history.end(token);
        return true as const;
      }),
  };
}
