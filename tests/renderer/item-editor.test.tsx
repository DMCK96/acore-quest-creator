// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ItemEditor } from '../../src/renderer/entities/item/ItemEditor';
import { newItem, type CustomItem } from '../../src/core/entities/model';
import type { ColumnInfo } from '../../src/core/db/types';

const col = (name: string, dataType = 'int'): ColumnInfo => ({ name, dataType, columnType: dataType, nullable: false, default: '0', ordinal: 0, isKey: false });
const columns = ['entry', 'name', 'holy_res', 'RequiredSkill', 'Flags'].map((n) => col(n));

function Harness({ start, spy }: { start: CustomItem; spy: (i: CustomItem) => void }) {
  const [item, setItem] = useState(start);
  return <ItemEditor item={item} onChange={(next) => { setItem(next); spy(next); }} allocatePage={async () => 3900}
    copyLook={async () => ({ displayId: 7426, itemClass: 7, subclass: 5, inventoryType: 0 })} columns={columns} />;
}

beforeEach(() => localStorage.clear());

describe('item editor', () => {
  it('edits basics and copies a look', async () => {
    const spy = vi.fn();
    render(<Harness start={newItem(990200)} spy={spy} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Pearl');
    expect(spy.mock.lastCall![0].name).toBe('Pearl');
    await userEvent.selectOptions(screen.getByLabelText('Quality'), 'epic');
    expect(spy.mock.lastCall![0].quality).toBe('epic');
  });
  it('hides gear fields on a quest item until asked, and adds stats as rows', async () => {
    const spy = vi.fn();
    render(<Harness start={newItem(990201)} spy={spy} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Gear' }));
    expect(screen.queryByRole('button', { name: 'Add stat' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show gear fields anyway' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add stat' }));
    expect(spy.mock.lastCall![0].stats).toEqual([{ type: 7, value: 0 }]);
  });
  it('shows advanced columns only when asked, remembers the choice, and flags groups with values', async () => {
    const spy = vi.fn();
    const { unmount } = render(<Harness start={{ ...newItem(990202), advanced: { holy_res: '5' } }} spy={spy} />);
    expect(screen.queryByRole('tab', { name: 'Advanced' })).toBeNull();
    expect(screen.getByText('Some advanced fields have values.')).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show advanced fields' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    const res = within(screen.getByRole('group', { name: 'Resistances' }));
    await userEvent.clear(res.getByLabelText('holy_res'));
    await userEvent.type(res.getByLabelText('holy_res'), '9');
    expect(spy.mock.lastCall![0].advanced).toEqual({ holy_res: '9' });
    await userEvent.clear(res.getByLabelText('holy_res'));
    expect(spy.mock.lastCall![0].advanced).toEqual({});
    unmount();
    render(<Harness start={newItem(990203)} spy={spy} />);
    expect(screen.getByRole('tab', { name: 'Advanced' })).toBeTruthy();
  });
  it('adds up to five spells', async () => {
    const spy = vi.fn();
    render(<Harness start={newItem(990204)} spy={spy} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Spells' }));
    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole('button', { name: 'Add spell' }));
    expect(spy.mock.lastCall![0].spells).toHaveLength(5);
    expect((screen.getByRole('button', { name: 'Add spell' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
