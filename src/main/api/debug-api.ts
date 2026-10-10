import type { DebugApi } from '../../shared/ipc';
import type { ApiDeps } from './deps';
import { fail, run } from './errors';

/** Debug mode: the timeline and the live-window probes; answers a plain error where the app has no controller (tests, headless) */
export function createDebugApi(deps: ApiDeps): DebugApi {
  const controller = () => {
    if (!deps.debug) throw fail('UNKNOWN', 'Debug mode is not available in this build.');
    return deps.debug;
  };
  return {
    debugStatus: () => run(async () => controller().status()),
    debugSetEnabled: (on) => run(() => controller().setEnabled(on)),
    debugEvents: (query) => run(async () => controller().events(query)),
    debugSnapshot: () => run(() => controller().snapshot()),
    debugType: (text) => run(() => controller().type(text)),
    captureScreenshot: (options) => run(() => controller().screenshot(options)),
    debugRecord: (batch) =>
      run(async () => {
        controller().ingest(batch);
        return null;
      }),
    debugAnswer: (id, answer) =>
      run(async () => {
        controller().answer(id, answer);
        return null;
      }),
  };
}
