// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RACES, CLASSES, ALLIANCE_MASK, HORDE_MASK, QUEST_SORTS, EMOTES } from '../../src/renderer/controls/game-data';
import { RaceMaskControl } from '../../src/renderer/controls/RaceMaskControl';
import { ClassMaskControl } from '../../src/renderer/controls/ClassMaskControl';
import { QuestSortControl } from '../../src/renderer/controls/QuestSortControl';
import { EmoteControl } from '../../src/renderer/controls/EmoteControl';
import { GroupPanel } from '../../src/renderer/groups/GroupPanel';
import { NamesProvider } from '../../src/renderer/state/names';
import { registry } from '@core/registry';
import { createNewAggregate } from '@core/import/new-quest';
import { loadSchema } from '@core/schema/load';
import { forkDb } from '../helpers/fixtures';
import { makeMockApi } from './mock-api';

const p = { id: 'f', label: 'Field', def: {} as any };

describe('game data', () => {
  it('pins the race and class bit values and faction presets', () => {
    expect(Object.fromEntries(RACES.map((r) => [r.label, r.bit]))).toEqual({
      Human: 1, Orc: 2, Dwarf: 4, 'Night Elf': 8, Undead: 16, Tauren: 32, Gnome: 64, Troll: 128, 'Blood Elf': 512, Draenei: 1024,
    });
    expect(ALLIANCE_MASK).toBe(1 | 4 | 8 | 64 | 1024);
    expect(HORDE_MASK).toBe(2 | 16 | 32 | 128 | 512);
    expect(Object.fromEntries(CLASSES.map((c) => [c.label, c.bit]))['Druid']).toBe(1024);
  });
  it('has unique, labelled sorts and emotes', () => {
    for (const list of [QUEST_SORTS, EMOTES]) {
      expect(list.length).toBeGreaterThan(5);
      expect(new Set(list.map((x) => x.value)).size).toBe(list.length);
      expect(list.every((x) => x.label.trim() !== '')).toBe(true);
    }
  });
});

describe('RaceMaskControl', () => {
  it('treats 0 as all races and picks a single race when one is chosen', async () => {
    const onChange = vi.fn();
    render(<RaceMaskControl {...p} value={0} onChange={onChange} type={{ kind: 'flags', flags: [] }} />);
    expect(screen.getByRole('checkbox', { name: 'All races' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Gnome' }));
    expect(onChange).toHaveBeenCalledWith(64);
  });
  it('offers Alliance-only and Horde-only presets', async () => {
    const onChange = vi.fn();
    render(<RaceMaskControl {...p} value={0} onChange={onChange} type={{ kind: 'flags', flags: [] }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Alliance only' }));
    expect(onChange).toHaveBeenLastCalledWith(1101);
    await userEvent.click(screen.getByRole('button', { name: 'Horde only' }));
    expect(onChange).toHaveBeenLastCalledWith(690);
  });
  it('shows "all" for the legacy all-bits value without changing it', () => {
    const onChange = vi.fn();
    render(<RaceMaskControl {...p} value={4294967295} onChange={onChange} type={{ kind: 'flags', flags: [] }} />);
    expect(screen.getByRole('checkbox', { name: 'All races' })).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('unchecking a race from a mask removes only that bit', async () => {
    const onChange = vi.fn();
    render(<RaceMaskControl {...p} value={1101} onChange={onChange} type={{ kind: 'flags', flags: [] }} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dwarf' }));
    expect(onChange).toHaveBeenCalledWith(1101 & ~4);
  });
});

describe('ClassMaskControl', () => {
  it('selects classes and returns to all classes at 0', async () => {
    const onChange = vi.fn();
    render(<ClassMaskControl {...p} value={0} onChange={onChange} type={{ kind: 'flags', flags: [] }} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Druid' }));
    expect(onChange).toHaveBeenCalledWith(1024);
  });
});

describe('QuestSortControl', () => {
  it('stores a sort category as a negative id and a zone as a positive id', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuestSortControl {...p} value={-QUEST_SORTS[1].value} onChange={onChange} type={{ kind: 'int' }} />);
    expect(screen.getByLabelText('Sorted by')).toHaveValue('category');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveDisplayValue(QUEST_SORTS[1].label);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), QUEST_SORTS[0].label);
    expect(onChange).toHaveBeenCalledWith(-QUEST_SORTS[0].value);
    rerender(<QuestSortControl {...p} value={12} onChange={onChange} type={{ kind: 'int' }} />);
    expect(screen.getByLabelText('Sorted by')).toHaveValue('zone');
    expect(screen.getByLabelText('Zone ID')).toHaveValue(12);
  });
});

describe('EmoteControl', () => {
  it('names known emotes and keeps custom ones', () => {
    const { rerender } = render(<EmoteControl {...p} value={EMOTES[0].value} onChange={() => {}} type={{ kind: 'idRef', target: 'emote' }} />);
    expect(screen.getByText(EMOTES[0].label)).toBeInTheDocument();
    rerender(<EmoteControl {...p} value={99999} onChange={() => {}} type={{ kind: 'idRef', target: 'emote' }} />);
    expect(screen.getByText('Custom emote (99999)')).toBeInTheDocument();
  });
});

describe('Identity and Story panels', () => {
  const mount = async (group: any, onChange = vi.fn()) => {
    const schema = await loadSchema(forkDb(), registry.tables.map((t) => t.table));
    const agg = createNewAggregate(schema, registry, 60001);
    return render(<NamesProvider api={makeMockApi()}><GroupPanel group={group} aggregate={agg} onChange={onChange} /></NamesProvider>);
  };
  it('lists the story texts in the order a player meets them', async () => {
    const { container } = await mount('story');
    const wanted = ['Quest title', 'Story text', 'Objectives text', 'In-progress text', 'Reward text', 'Log text when complete'];
    const labels = [...container.querySelectorAll('label')].map((l) => l.textContent!.trim()).filter((t) => wanted.includes(t));
    expect(labels).toEqual(wanted);
  });
  it('shows the quest ID as read-only and puts levels before races', async () => {
    const { container } = await mount('identity');
    expect(screen.getByLabelText('ID')).toBeDisabled();
    const text = container.textContent!;
    expect(text.indexOf('Quest level')).toBeLessThan(text.indexOf('Races'));
    expect(screen.getByRole('checkbox', { name: 'All races' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'All classes' })).toBeInTheDocument();
  });
});
