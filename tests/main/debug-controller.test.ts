import { describe, expect, it, vi } from 'vitest';
import { createDebugController, type DebugWindowPort } from '../../src/main/debug/controller';
import { createDebugRecorder } from '../../src/main/debug/recorder';
import type { RendererAnswer, RendererQuery, WindowState } from '../../src/shared/ipc';

const open: WindowState = { focused: true, contentsFocused: true, visible: true, minimized: false };
const focus = { documentHasFocus: true, active: 'input#npc-search', activeState: { editable: true, disabled: false, readOnly: false }, blockedBy: [], modals: ['div.modal'], coveredBy: null };

function rig(over: { enabled?: boolean; state?: WindowState | null; answers?: (RendererAnswer | null)[]; capture?: DebugWindowPort['capture'] } = {}) {
  let flag = over.enabled ?? false;
  const asked: RendererQuery[] = [];
  const answers = [...(over.answers ?? [])];
  const typed: string[] = [];
  const announced: boolean[] = [];
  const written: string[] = [];
  let closed = 0;
  let clock = 1_000;
  const recorder = createDebugRecorder({ now: () => clock });
  const controller = createDebugController({
    settings: { enabled: () => flag, setEnabled: (on) => { flag = on; } },
    recorder,
    logs: { open: async () => ({ path: 'logs/debug-x.jsonl', write: (l) => { written.push(l); }, close: async () => { closed += 1; }, failures: () => 0, truncated: () => false }) },
    window: {
      state: () => (over.state === undefined ? open : over.state),
      capture: over.capture ?? (async () => ({ data: 'AAAA', width: 800, height: 600 })),
      sendText: async (t) => { typed.push(t); },
      announce: (e) => { announced.push(e); },
    },
    link: { ask: async (q) => { asked.push(q); return answers.shift() ?? null; }, answer: () => {} },
    settleMs: 0,
  });
  return { controller, recorder, asked, typed, announced, written, closed: () => closed, tick: (ms: number) => { clock += ms; } };
}

const gated = { code: 'NOT_ENABLED', message: 'Turn on Debug mode in Preferences first.' };

describe('the debug controller', () => {
  it('is off by default and says so', () => {
    const { controller } = rig();
    expect(controller.status()).toMatchObject({ enabled: false, events: 0, capacity: 5000, logFile: null, window: open });
  });

  it('switching on persists, starts recording and the log, and tells the window; off undoes all three', async () => {
    const { controller, recorder, announced, closed } = rig();
    const seen: boolean[] = [];
    controller.onChange((e) => seen.push(e));
    expect((await controller.setEnabled(true)).logFile).toBe('logs/debug-x.jsonl');
    expect(recorder.enabled()).toBe(true);
    expect(announced).toEqual([true]);
    await controller.setEnabled(false);
    expect(recorder.enabled()).toBe(false);
    expect(closed()).toBe(1);
    expect(announced).toEqual([true, false]);
    expect(seen).toEqual([true, false]);
    expect(controller.status().logFile).toBeNull();
  });

  it('start() applies the saved setting at launch', async () => {
    const { controller, recorder } = rig({ enabled: true });
    await controller.start();
    expect(recorder.enabled()).toBe(true);
    expect(controller.status().enabled).toBe(true);
  });

  it('notes and renderer batches are recorded only while on, with the right source', async () => {
    const { controller, tick } = rig();
    controller.note('window', 'focus');
    controller.ingest([{ at: 1_000, category: 'input', name: 'keydown' }]);
    expect(controller.events()).toEqual([]);
    await controller.setEnabled(true);
    tick(10);
    controller.note('window', 'focus', { contentsFocused: true });
    controller.ingest([{ at: 1_000, category: 'input', name: 'keydown', data: { code: 'KeyA' } }]);
    expect(controller.events().map((e) => [e.source, e.name])).toEqual([['renderer', 'keydown'], ['main', 'focus']]);
  });

  it('snapshot and type are refused while off, with the exact message', async () => {
    const { controller } = rig();
    await expect(controller.snapshot()).rejects.toMatchObject({ error: gated });
    await expect(controller.type('abc')).rejects.toMatchObject({ error: gated });
  });

  it('snapshot returns main\'s view and the page\'s answer', async () => {
    const { controller } = rig({ enabled: true, answers: [{ focus, field: null }] });
    await controller.start();
    expect(await controller.snapshot()).toEqual({ main: open, renderer: focus, rendererAnswered: true });
  });

  it('snapshot still answers, and says so, when the page does not', async () => {
    const { controller } = rig({ enabled: true, answers: [null] });
    await controller.start();
    expect(await controller.snapshot()).toEqual({ main: open, renderer: null, rendererAnswered: false });
  });

  it('type looks, types, looks again, and reports whether the field changed', async () => {
    const { controller, asked, typed } = rig({
      enabled: true,
      answers: [
        { focus, field: { target: 'input#npc-search', value: '' } },
        { focus, field: { target: 'input#npc-search', value: 'abc' } },
      ],
    });
    await controller.start();
    const out = await controller.type('abc');
    expect(typed).toEqual(['abc']);
    expect(asked).toEqual([{ kind: 'snapshot', includeValue: true }, { kind: 'snapshot', includeValue: true }]);
    expect(out).toMatchObject({ typed: 3, changed: true, window: open });
    expect(out.before?.value).toBe('');
    expect(out.after?.value).toBe('abc');
    expect(controller.events().some((e) => e.category === 'probe' && e.name === 'type')).toBe(true);
  });

  it('type reports changed=false when the value did not move', async () => {
    const same = { focus, field: { target: 'input#npc-search', value: 'x' } };
    const { controller } = rig({ enabled: true, answers: [same, same] });
    await controller.start();
    expect((await controller.type('abc')).changed).toBe(false);
  });

  it('screenshot works with Debug mode off, defaults to 1600 wide and carries the window state', async () => {
    const capture = vi.fn(async () => ({ data: 'AAAA', width: 800, height: 600 }));
    const { controller } = rig({ capture });
    expect(await controller.screenshot()).toEqual({ width: 800, height: 600, mimeType: 'image/png', data: 'AAAA', window: open });
    expect(capture).toHaveBeenCalledWith({ maxWidth: 1600 });
  });

  it('screenshot of a selector asks the page for its rectangle first', async () => {
    const capture = vi.fn(async () => ({ data: 'AAAA', width: 400, height: 300 }));
    const { controller, asked } = rig({ capture, answers: [{ rect: { x: 10, y: 20, width: 400, height: 300 } }] });
    await controller.screenshot({ selector: '.modal', maxWidth: 500 });
    expect(asked).toEqual([{ kind: 'rect', selector: '.modal' }]);
    expect(capture).toHaveBeenCalledWith({ rect: { x: 10, y: 20, width: 400, height: 300 }, maxWidth: 500 });
  });

  it('screenshot says plainly when the selector matches nothing or the window cannot be captured', async () => {
    const none = rig({ answers: [{ rect: null }] });
    await expect(none.controller.screenshot({ selector: '.nope' })).rejects.toMatchObject({ error: { code: 'BAD_REQUEST', message: 'Nothing on screen matches that selector.' } });
    const hidden = rig({ capture: async () => null });
    await expect(hidden.controller.screenshot()).rejects.toMatchObject({ error: { code: 'BAD_REQUEST', message: 'The window is hidden or minimised, so there is nothing to capture.' } });
  });

  it('cameraStatus and cameraTeleport ask the page, with Debug mode off', async () => {
    const camera = { map: 0, x: 1, y: 2, z: 3, area: null };
    const { controller, asked } = rig({ answers: [{ camera }, { camera }] });
    expect(await controller.cameraStatus()).toEqual(camera);
    expect(await controller.cameraTeleport({ map: 0, x: 1, y: 2, z: 3 })).toEqual(camera);
    expect(asked).toEqual([{ kind: 'camera' }, { kind: 'teleport', target: { map: 0, x: 1, y: 2, z: 3 } }]);
  });

  it('the camera calls say plainly when the page does not answer or has no 3D view', async () => {
    const { controller } = rig({ answers: [{ camera: null }] });
    await expect(controller.cameraStatus()).rejects.toMatchObject({ message: expect.stringMatching(/3D view/) });
    await expect(controller.cameraStatus()).rejects.toMatchObject({ message: expect.stringMatching(/did not answer/) });
  });
});
