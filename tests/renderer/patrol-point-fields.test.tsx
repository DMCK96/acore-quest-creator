// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NamesProvider } from '../../src/renderer/state/names';
import { PatrolPointFields } from '../../src/renderer/world3d/PatrolPointFields';
import { makeMockApi } from './mock-api';
import { addAction, addPoint, newPatrol } from '../../src/core/map/patrol';

const three = () => addPoint(addPoint(addPoint(newPatrol(9000), { x: 10, y: 0, z: 50 }), { x: 10, y: 10, z: 50 }), { x: 0, y: 10, z: 50 });

describe('a patrol point\'s fields', () => {
  it('warns when an action comes after the NPC has walked on', () => {
    const late = addAction(three(), 1, { id: 'a1', afterSecs: 12, kind: 'emote', emote: 3 });
    render(<NamesProvider api={makeMockApi()}><PatrolPointFields idPrefix="p" patrol={late} index={1} onChange={vi.fn()} /></NamesProvider>);
    const form = screen.getByRole('group', { name: 'Plays an emote' });
    expect(within(form).getByText('It only waits 0 s here, so this may be cut short when it walks on.')).toBeTruthy();
  });
});
