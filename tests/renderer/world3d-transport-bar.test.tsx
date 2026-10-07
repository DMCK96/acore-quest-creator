import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransportBar } from '../../src/renderer/world3d/TransportBar';
import { NODE_STOP, type TaxiNode } from '../../src/core/game/taxi-path';
import type { WorldMap } from '../../src/core/map/world-maps';

const n = (index: number, map: number, flags = 0): TaxiNode => ({ index, map, x: index, y: 0, z: 0, flags, delay: 0 });
const make = (templates: number): WorldMap => ({
  id: 672, name: 'Gunship', directory: 'IcecrownCitadel', kind: 'transport', start: { x: 0, y: 0, z: 0 },
  transport: {
    templates: Array.from({ length: templates }, (_, i) => ({ entry: i + 1, name: `Route ${i + 1}`, displayId: 9, pathId: 10 + i })),
    paths: { 10: [n(0, 631), n(1, 631, NODE_STOP)], 11: [n(0, 631)] },
  },
});
const name = () => 'Icecrown Citadel';

describe('the transport bar', () => {
  it('offers a route only when the map has several, and always the stops', () => {
    const { rerender } = render(<TransportBar map={make(1)} view={{ template: 1, node: 1 }} hostName={name} onView={() => {}} />);
    expect(screen.queryByLabelText('Route')).toBeNull();
    expect(screen.getByLabelText('Stop')).toBeTruthy();
    expect(screen.getByText(/can't be edited here/)).toBeTruthy();
    rerender(<TransportBar map={make(2)} view={{ template: 1, node: 1 }} hostName={name} onView={() => {}} />);
    expect(screen.getByLabelText('Route')).toBeTruthy();
  });
  it('changing the stop reports the new node on the same route', () => {
    const onView = vi.fn();
    render(<TransportBar map={make(1)} view={{ template: 1, node: 1 }} hostName={name} onView={onView} />);
    fireEvent.change(screen.getByLabelText('Stop'), { target: { value: '0' } });
    expect(onView).toHaveBeenCalledWith({ template: 1, node: 0 });
  });
  it('changing the route starts the new route at its own first stop and keeps the map', () => {
    const onView = vi.fn();
    render(<TransportBar map={make(2)} view={{ template: 1, node: 1 }} hostName={name} onView={onView} />);
    fireEvent.change(screen.getByLabelText('Route'), { target: { value: '2' } });
    expect(onView).toHaveBeenCalledWith({ template: 2, node: 0 });
  });
});
