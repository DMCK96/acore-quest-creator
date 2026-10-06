// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventPicker } from '../../src/renderer/controls/EventPicker';
import { EventRuleField } from '../../src/renderer/entities/EventRuleField';
import type { EventRule } from '../../src/core/entities/model';

const events = [{ id: 12, name: 'Darkmoon Faire' }, { id: 4, name: "Hallow's End" }, { id: 7, name: '' }];

describe('the event picker', () => {
  it('with several, adds chips and takes them off', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<EventPicker id="t" events={events} chosen={[]} multiple onChange={onChange} />);
    expect(screen.getByText('Choose at least one event')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Which events'), 'hallow');
    await userEvent.click(screen.getByRole('option', { name: "Hallow's End" }));
    expect(onChange).toHaveBeenLastCalledWith([4]);
    rerender(<EventPicker id="t" events={events} chosen={[4, 7]} multiple onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Remove Event 7' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: "Remove Hallow's End" }));
    expect(onChange).toHaveBeenLastCalledWith([7]);
  });

  it('with one, picks one and says when none is chosen', async () => {
    const onChange = vi.fn();
    render(<EventPicker id="t" events={events} chosen={[]} onChange={onChange} />);
    expect(screen.getByText('Choose an event')).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: 'Darkmoon Faire' }));
    expect(onChange).toHaveBeenLastCalledWith([12]);
  });

  it('says when the database has no events', () => {
    render(<EventPicker id="t" events={[]} chosen={[]} multiple onChange={vi.fn()} />);
    expect(screen.getByText('No events in the database')).toBeTruthy();
  });
});

describe('the event rule field', () => {
  function Live({ start, onSaved }: { start: EventRule | 'npc'; onSaved(v: unknown): void }) {
    const [value, setValue] = useState<EventRule | 'npc' | 'asIs'>(start);
    return <EventRuleField id="r" events={events} value={value} inherit="Same as the NPC" onChange={(v) => { onSaved(v); setValue(v); }} />;
  }

  it('keeps an unfinished choice to itself until an event is picked, then saves a sorted rule', async () => {
    const onSaved = vi.fn();
    render(<Live start="npc" onSaved={onSaved} />);
    await userEvent.selectOptions(screen.getByLabelText('Event'), 'Only during…');
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText('Choose at least one event')).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: 'Darkmoon Faire' }));
    expect(onSaved).toHaveBeenLastCalledWith({ mode: 'during', events: [12] });
    await userEvent.click(screen.getByRole('option', { name: "Hallow's End" }));
    expect(onSaved).toHaveBeenLastCalledWith({ mode: 'during', events: [4, 12] });
    await userEvent.selectOptions(screen.getByLabelText('Event'), 'Gone during…');
    expect(onSaved).toHaveBeenLastCalledWith({ mode: 'except', events: [4, 12] });
    await userEvent.selectOptions(screen.getByLabelText('Event'), 'Always');
    expect(onSaved).toHaveBeenLastCalledWith(null);
    await userEvent.selectOptions(screen.getByLabelText('Event'), 'Same as the NPC');
    expect(onSaved).toHaveBeenLastCalledWith('npc');
  });

  it('offers As each spawn has it only when asked, and not Same as the NPC without a label', () => {
    render(<EventRuleField id="r" events={events} value="asIs" asIs onChange={vi.fn()} />);
    const options = within(screen.getByLabelText('Event')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['As each spawn has it', 'Always', 'Only during…', 'Gone during…']);
  });
});
