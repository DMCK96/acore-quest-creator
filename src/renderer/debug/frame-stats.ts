import type { DebugEventInput } from '@shared/ipc';

/** One frame of the 3D view, as the tick measured it */
export interface FrameSample {
  deltaSeconds: number;
  /** Controls, the map manager, spawns and the editor: everything before drawing */
  updateMs: number;
  /** `renderer.render()` */
  renderMs: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Where the camera is */
  x: number;
  y: number;
  z: number;
}

export interface FrameStats {
  /** Sampling is wanted; the 3D view reads the clock and `renderer.info` only while this is true */
  readonly on: boolean;
  attach(report: (event: DebugEventInput) => void, now: () => number): void;
  detach(): void;
  sample(frame: FrameSample): void;
}

const DEFAULT_INTERVAL_SECONDS = 1;
/** Summing frame times of 0.1 s ten times gives 0.9999999999999999, which is a full second */
const EPSILON = 1e-9;

const tenth = (value: number): number => Math.round(value * 10) / 10;

/**
 * Frame rate, update and render time and draw calls of the 3D view, reported as one `perf`/`frame` event
 * about every second while Debug mode is on. Totals are plain numbers, so a frame costs no allocation.
 */
export function createFrameStats(options: { intervalSeconds?: number } = {}): FrameStats {
  const interval = options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  let report: ((event: DebugEventInput) => void) | null = null;
  let now: () => number = () => 0;
  let frames = 0;
  let seconds = 0;
  let updateMs = 0;
  let renderMs = 0;

  const reset = (): void => {
    frames = 0;
    seconds = 0;
    updateMs = 0;
    renderMs = 0;
  };

  return {
    get on() {
      return report !== null;
    },
    attach(next, clock) {
      report = next;
      now = clock;
      reset();
    },
    detach() {
      report = null;
      reset();
    },
    sample(frame) {
      if (!report) return;
      frames += 1;
      seconds += frame.deltaSeconds;
      updateMs += frame.updateMs;
      renderMs += frame.renderMs;
      if (seconds < interval - EPSILON) return;
      const data = {
        fps: tenth(frames / seconds),
        updateMs: tenth(updateMs / frames),
        renderMs: tenth(renderMs / frames),
        calls: Math.round(frame.calls),
        triangles: Math.round(frame.triangles),
        geometries: Math.round(frame.geometries),
        textures: Math.round(frame.textures),
        programs: Math.round(frame.programs),
        x: Math.round(frame.x),
        y: Math.round(frame.y),
        z: Math.round(frame.z),
      };
      reset();
      report({ at: now(), category: 'perf', name: 'frame', data });
    },
  };
}

/** The one instance the 3D view samples into and the debug bridge switches on and off */
export const frameStats: FrameStats = createFrameStats();
