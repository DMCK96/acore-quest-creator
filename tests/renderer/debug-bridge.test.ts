// tests/renderer/debug-bridge.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDebugBridge } from '../../src/renderer/debug/bridge';
import { frameStats, type FrameSample } from '../../src/renderer/debug/frame-stats';
import { registerCameraHandle } from '../../src/renderer/world3d/camera-handle';
import type { RendererRequest } from '../../src/shared/ipc';

const ok = <T,>(value: T) => ({ ok: true as const, value });

function rig(enabled: boolean) {
  const record = vi.fn(async () => ok(null));
  const answer = vi.fn(async () => ok(null));
  const handlers: { changed?: (on: boolean) => void; request?: (r: RendererRequest) => void } = {};
  const stop = startDebugBridge({
    api: { debugStatus: async () => ok({ enabled } as never), debugRecord: record as never, debugAnswer: answer as never },
    events: { onDebugChanged: (h) => { handlers.changed = h; }, onDebugRequest: (h) => { handlers.request = h; } },
    win: window,
    flushMs: 250,
  });
  return { record, answer, handlers, stop };
}
const press = (el: Element) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }));
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };
const frame = (over: Partial<FrameSample> = {}): FrameSample => ({ deltaSeconds: 0.1, updateMs: 2, renderMs: 8, calls: 120, triangles: 50000, geometries: 90, textures: 40, programs: 6, x: 1, y: 2, z: 3, ...over });
const oneSecond = () => { for (let i = 0; i < 10; i++) frameStats.sample(frame()); };

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<input id="a" value="hello">'; });
afterEach(() => { frameStats.detach(); vi.useRealTimers(); document.body.innerHTML = ''; });

describe('the debug bridge', () => {
  it('asks the main process whether Debug mode is on at start, and records nothing when it is off', async () => {
    const { record, stop } = rig(false);
    await settle();
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).not.toHaveBeenCalled();
    stop();
  });

  it('attaches the taps when it starts on and sends what they record in one batch about every 250 ms', async () => {
    const { record, stop } = rig(true);
    await settle();
    document.getElementById('a')!.focus();
    press(document.getElementById('a')!);
    expect(record).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(record).toHaveBeenCalledTimes(1);
    const batch = (record.mock.calls[0] as unknown[])[0] as { name: string }[];
    expect(batch.map((e) => e.name)).toContain('keydown');
    stop();
  });

  it('follows the pushed flag: on attaches, off detaches and flushes nothing more', async () => {
    const { record, handlers, stop } = rig(false);
    await settle();
    handlers.changed!(true);
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(250);
    expect(record).toHaveBeenCalledTimes(1);
    handlers.changed!(false);
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).toHaveBeenCalledTimes(1);
    stop();
  });

  it('answers a snapshot request with the focus state, with the value only when asked', async () => {
    const { answer, handlers, stop } = rig(true);
    await settle();
    document.getElementById('a')!.focus();
    handlers.request!({ id: 5, kind: 'snapshot', includeValue: true });
    handlers.request!({ id: 6, kind: 'snapshot', includeValue: false });
    expect((answer.mock.calls[0] as unknown[])[0]).toBe(5);
    expect((answer.mock.calls[0] as any)[1]).toMatchObject({ focus: { active: 'input#a' }, field: { target: 'input#a', value: 'hello' } });
    expect((answer.mock.calls[1] as any)[1].field.value).toBe('');
    stop();
  });

  it('answers a rect request for a selector', async () => {
    const { answer, handlers, stop } = rig(true);
    await settle();
    (document.getElementById('a') as any).getBoundingClientRect = () => ({ x: 1, y: 2, width: 3, height: 4 });
    handlers.request!({ id: 9, kind: 'rect', selector: '#a' });
    expect(answer).toHaveBeenCalledWith(9, { rect: { x: 1, y: 2, width: 3, height: 4 } });
    stop();
  });

  it('answers requests even when Debug mode is off, so a probe never hangs on a quiet window', async () => {
    const { answer, handlers, stop } = rig(false);
    await settle();
    handlers.request!({ id: 1, kind: 'rect', selector: '.nope' });
    expect(answer).toHaveBeenCalledWith(1, { rect: null });
    stop();
  });

  it('stop() removes the taps and the timer', async () => {
    const { record, stop } = rig(true);
    await settle();
    stop();
    press(document.getElementById('a')!);
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('the debug bridge and the 3D view\'s frame stats', () => {
  it('turns the frame sampler on with Debug mode, and sends its event in the next batch', async () => {
    const { record, stop } = rig(true);
    await settle();
    expect(frameStats.on).toBe(true);
    oneSecond();
    await vi.advanceTimersByTimeAsync(250);
    const batch = (record.mock.calls[0] as unknown[])[0] as { category: string; name: string }[];
    expect(batch.some((e) => e.category === 'perf' && e.name === 'frame')).toBe(true);
    stop();
  });

  it('turns the sampler off when Debug mode is switched off, and records nothing more', async () => {
    const { record, handlers, stop } = rig(true);
    await settle();
    handlers.changed!(false);
    expect(frameStats.on).toBe(false);
    oneSecond();
    await vi.advanceTimersByTimeAsync(1000);
    expect(record).not.toHaveBeenCalled();
    stop();
  });

  it('leaves the sampler off when Debug mode is off at start, and switches it on when it is pushed on', async () => {
    const { handlers, stop } = rig(false);
    await settle();
    expect(frameStats.on).toBe(false);
    handlers.changed!(true);
    expect(frameStats.on).toBe(true);
    stop();
    expect(frameStats.on).toBe(false);
  });

  it('answers camera questions from the World view, and null when none is open', async () => {
    const { answer, handlers, stop } = rig(false);
    await settle();
    handlers.request!({ id: 1, kind: 'camera' });
    expect(answer).toHaveBeenLastCalledWith(1, { camera: null });
    const state = { map: 0, x: 1, y: 2, z: 3, area: 'Elwynn' };
    const teleport = vi.fn(() => state);
    const unregister = registerCameraHandle({ status: () => state, teleport });
    handlers.request!({ id: 2, kind: 'camera' });
    expect(answer).toHaveBeenLastCalledWith(2, { camera: state });
    handlers.request!({ id: 3, kind: 'teleport', target: { map: 0, x: 1, y: 2, z: 3 } });
    expect(teleport).toHaveBeenCalledWith({ map: 0, x: 1, y: 2, z: 3 });
    expect(answer).toHaveBeenLastCalledWith(3, { camera: state });
    unregister();
    handlers.request!({ id: 4, kind: 'camera' });
    expect(answer).toHaveBeenLastCalledWith(4, { camera: null });
    stop();
  });
});
