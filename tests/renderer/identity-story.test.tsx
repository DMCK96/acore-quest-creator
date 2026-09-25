// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RACES, CLASSES, ALLIANCE_MASK, HORDE_MASK, EMOTES } from '../../src/renderer/controls/game-data';
import { QUEST_SORT_CATEGORIES } from '../../src/core/game/quest-sorts';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { RaceMaskControl } from '../../src/renderer/controls/RaceMaskControl';
import { ClassMaskControl } from '../../src/renderer/controls/ClassMaskControl';
import { QuestSortControl } from '../../src/renderer/controls/QuestSortControl';
import { EmoteControl } from '../../src/renderer/controls/EmoteControl';
import { mountBody } from './module-harness';

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
    for (const list of [QUEST_SORT_CATEGORIES.map((c) => ({ value: c.id, label: c.name })), EMOTES]) {
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
  const api = () => makeMockApi({
    lookupNames: vi.fn(async (_kind: string, ids: number[]) =>
      okv(Object.fromEntries(ids.flatMap((i) => (i === 12 ? [[i, 'Elwynn Forest']] : i === -81 ? [[i, 'Warrior']] : []))))),
    searchEntities: vi.fn(async () => okv([
      { id: -81, name: 'Warrior', detail: 'Category' },
      { id: 12, name: 'Elwynn Forest', detail: 'Zone in Eastern Kingdoms' },
    ])),
  });

  it('shows the heading by name, zone or category', async () => {
    const { rerender } = render(<NamesProvider api={api()}><QuestSortControl {...p} value={12} onChange={() => {}} /></NamesProvider>);
    expect(await screen.findByDisplayValue('Elwynn Forest')).toBeInTheDocument();
    rerender(<NamesProvider api={api()}><QuestSortControl {...p} value={-81} onChange={() => {}} /></NamesProvider>);
    expect(await screen.findByDisplayValue('Warrior')).toBeInTheDocument();
    expect(screen.queryByText('#-81')).toBeNull();
  });

  it('searches zones and categories together and stores what is picked', async () => {
    const onChange = vi.fn();
    const mock = api();
    render(<NamesProvider api={mock}><QuestSortControl {...p} value={0} onChange={onChange} /></NamesProvider>);
    await userEvent.type(screen.getByRole('combobox', { name: 'Field' }), 'w');
    await userEvent.click(await screen.findByRole('option', { name: 'Warrior · Category' }));
    expect(mock.searchEntities).toHaveBeenCalledWith('questSort', 'w');
    expect(onChange).toHaveBeenLastCalledWith(-81);
    await userEvent.type(screen.getByRole('combobox', { name: 'Field' }), 'e');
    await userEvent.click(await screen.findByRole('option', { name: 'Elwynn Forest · Zone in Eastern Kingdoms · #12' }));
    expect(onChange).toHaveBeenLastCalledWith(12);
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

describe('Dialogue and Requirements modules', () => {
  it('lists the dialogue texts in the order a player meets them', async () => {
    await mountBody('dialogue');
    const wanted = ['Offer text', 'Progress text', 'Turn-in text', 'Completion log line'];
    const labels = [...document.querySelectorAll('label')].map((l) => l.textContent!.trim()).filter((t) => wanted.includes(t));
    expect(labels).toEqual(wanted);
  });
  it('edits races and classes as checkboxes', async () => {
    await mountBody('requirements');
    expect(screen.getByRole('checkbox', { name: 'All races' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'All classes' })).toBeInTheDocument();
  });
});
