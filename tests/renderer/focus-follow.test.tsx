// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusFollow } from '../../src/renderer/world3d/useFocusFollow';

const base = () => ({
  focus: { questId: 5, part: null, nonce: 1, at: 10 },
  lastCameraMove: () => 0,
  shown: true,
  placeOf: vi.fn(async () => ({ spawn: { map: 0, x: 1, y: 2, z: 3, guid: 1 }, name: 'Quest' })),
  jump: vi.fn(),
  select: vi.fn(),
  note: vi.fn(),
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const bob = { kind: 'creature' as const, entry: 9 };

describe('useFocusFollow', () => {
  it('jumps to the quest', async () => {
    const p = base();
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.placeOf).toHaveBeenCalledWith({ questId: 5 });
    expect(p.jump).toHaveBeenCalledWith({ map: 0, x: 1, y: 2, z: 3 });
  });

  it('says so when nothing is placed, and does not jump', async () => {
    const p = { ...base(), placeOf: vi.fn(async () => ({ spawn: null, name: undefined })) };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.jump).not.toHaveBeenCalled();
    expect(p.note).toHaveBeenCalledWith('Nothing of this quest is placed in the world yet.');
  });

  it('goes to a part and selects it, or names a part with no spawn', async () => {
    const p = { ...base(), focus: { questId: 5, part: { kind: 'creature' as const, entry: 9 }, nonce: 2, at: 10 }, placeOf: vi.fn(async () => ({ spawn: { map: 0, x: 4, y: 5, z: 6, guid: 77 }, name: 'Bob' })) };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.jump).toHaveBeenCalled();
    expect(p.select).toHaveBeenCalledWith({ kind: 'creature', guid: 77 });
    const q = { ...base(), focus: { questId: 5, part: { kind: 'creature' as const, entry: 9 }, nonce: 3, at: 10 }, placeOf: vi.fn(async () => ({ spawn: null, name: 'Bob' })) };
    renderHook(() => useFocusFollow(q));
    await flush();
    expect(q.note).toHaveBeenCalledWith('Bob has no spawn in the world yet.');
  });

  it('does not pull a camera the author moved after the focus', async () => {
    const p = { ...base(), lastCameraMove: () => 99 };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.jump).not.toHaveBeenCalled();
    expect(p.note).not.toHaveBeenCalled();
  });

  // The view hidden and shown again runs the effect again with the same focus: it is not followed twice
  it('handles each nonce once', async () => {
    const p = base();
    const { rerender } = renderHook((shown: boolean) => useFocusFollow({ ...p, shown }), { initialProps: true });
    await flush();
    rerender(false);
    rerender(true);
    await flush();
    expect(p.placeOf).toHaveBeenCalledTimes(1);
    expect(p.jump).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a 3D view', async () => {
    const p = { ...base(), shown: false };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.placeOf).not.toHaveBeenCalled();
  });

  it('still selects a part when the camera moved, without moving it', async () => {
    const p = { ...base(), lastCameraMove: () => 99, focus: { questId: 5, part: bob, nonce: 2, at: 10 }, placeOf: vi.fn(async () => ({ spawn: { map: 0, x: 4, y: 5, z: 6, guid: 77 }, name: 'Bob' })) };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.jump).not.toHaveBeenCalled();
    expect(p.select).toHaveBeenCalledWith({ kind: 'creature', guid: 77 });
  });

  it('does not jump when the camera moves while the place is being read', async () => {
    let moved = 0;
    const p = { ...base(), lastCameraMove: () => moved, placeOf: vi.fn(async () => {
      moved = 20;
      return { spawn: { map: 0, x: 1, y: 2, z: 3, guid: 1 }, name: 'Quest' };
    }) };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.jump).not.toHaveBeenCalled();
  });

  it('leaves alone a focus the view set from its own selection', async () => {
    const p = { ...base(), focus: { questId: 5, part: bob, nonce: 2, at: 10 }, selected: () => bob };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.placeOf).not.toHaveBeenCalled();
    expect(p.jump).not.toHaveBeenCalled();
  });

  it('says why the place could not be read', async () => {
    const p = { ...base(), placeOf: vi.fn(async () => ({ error: 'Needs the world database' })) };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.note).toHaveBeenCalledWith('Needs the world database');
    expect(p.jump).not.toHaveBeenCalled();
  });

  it('follows nothing before any quest is focused', async () => {
    const p = { ...base(), focus: { questId: null, part: null, nonce: 4, at: 10 } };
    renderHook(() => useFocusFollow(p));
    await flush();
    expect(p.placeOf).not.toHaveBeenCalled();
  });
});
