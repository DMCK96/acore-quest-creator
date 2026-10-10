// tests/renderer/debug-frame-stats.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createFrameStats, type FrameSample } from '../../src/renderer/debug/frame-stats';

const frame = (over: Partial<FrameSample> = {}): FrameSample => ({
  deltaSeconds: 0.1, updateMs: 2, renderMs: 8, calls: 120, triangles: 50000, geometries: 90, textures: 40, programs: 6, x: 1.4, y: 2.6, z: 3, ...over,
});

describe('frame stats', () => {
  it('is off until attached, and ignores frames while off', () => {
    const stats = createFrameStats();
    const report = vi.fn();
    expect(stats.on).toBe(false);
    for (let i = 0; i < 30; i++) stats.sample(frame());
    expect(report).not.toHaveBeenCalled();
    stats.attach(report, () => 5);
    expect(stats.on).toBe(true);
  });

  it('reports one perf/frame event a second with means, the frame rate and the last counts', () => {
    const stats = createFrameStats();
    const report = vi.fn();
    stats.attach(report, () => 1234);
    for (let i = 0; i < 9; i++) stats.sample(frame({ renderMs: 6 }));
    expect(report).not.toHaveBeenCalled();
    stats.sample(frame({ renderMs: 15, calls: 130, x: 10.4 }));
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      at: 1234, category: 'perf', name: 'frame',
      data: { fps: 10, updateMs: 2, renderMs: 6.9, calls: 130, triangles: 50000, geometries: 90, textures: 40, programs: 6, x: 10, y: 3, z: 3 },
    });
  });

  it('starts a fresh second after each report', () => {
    const stats = createFrameStats();
    const report = vi.fn();
    stats.attach(report, () => 0);
    for (let i = 0; i < 20; i++) stats.sample(frame());
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('detach stops reporting and discards the partial second', () => {
    const stats = createFrameStats();
    const report = vi.fn();
    stats.attach(report, () => 0);
    for (let i = 0; i < 5; i++) stats.sample(frame());
    stats.detach();
    expect(stats.on).toBe(false);
    for (let i = 0; i < 30; i++) stats.sample(frame());
    expect(report).not.toHaveBeenCalled();
    stats.attach(report, () => 0);
    for (let i = 0; i < 9; i++) stats.sample(frame());
    expect(report).not.toHaveBeenCalled();
  });
});
