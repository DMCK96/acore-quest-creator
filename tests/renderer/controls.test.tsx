// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntControl } from '../../src/renderer/controls/IntControl';
import { EnumControl } from '../../src/renderer/controls/EnumControl';
import { FlagsControl } from '../../src/renderer/controls/FlagsControl';
import { MoneyControl } from '../../src/renderer/controls/MoneyControl';
import { IdRefControl } from '../../src/renderer/controls/IdRefControl';
import { CreatureOrGoControl } from '../../src/renderer/controls/CreatureOrGoControl';
import { ListEditor } from '../../src/renderer/controls/ListEditor';
import { LongTextControl } from '../../src/renderer/controls/LongTextControl';
import { NamesProvider } from '../../src/renderer/state/names';
import { resolveControl, NoControlError } from '../../src/renderer/controls/resolve';
import { makeMockApi, okv } from './mock-api';

const base = { id: 'f', label: 'Field' };

describe('IntControl', () => {
  it('reports valid integers and flags invalid text without calling onChange', async () => {
    const onChange = vi.fn();
    render(<IntControl {...base} value={5} onChange={onChange} type={{ kind: 'int', min: 0 }} def={{} as any} />);
    const input = screen.getByLabelText('Field');
    await userEvent.clear(input); await userEvent.type(input, '12');
    expect(onChange).toHaveBeenLastCalledWith(12);
    onChange.mockClear();
    await userEvent.clear(input); await userEvent.type(input, 'abc');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/whole number/i);
  });
  it('rejects values below the minimum', async () => {
    const onChange = vi.fn();
    render(<IntControl {...base} value={5} onChange={onChange} type={{ kind: 'int', min: 0 }} def={{} as any} />);
    await userEvent.clear(screen.getByLabelText('Field')); await userEvent.type(screen.getByLabelText('Field'), '-3');
    expect(onChange).not.toHaveBeenCalledWith(-3);
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 0/i);
  });
});

describe('EnumControl', () => {
  const options = [{ value: 0, label: 'None' }, { value: 1, label: 'Group' }];
  it('selects by label and shows unknown values without losing them', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<EnumControl {...base} value={1} onChange={onChange} type={{ kind: 'enum', options }} def={{} as any} />);
    await userEvent.selectOptions(screen.getByLabelText('Field'), 'None');
    expect(onChange).toHaveBeenCalledWith(0);
    rerender(<EnumControl {...base} value={99} onChange={onChange} type={{ kind: 'enum', options }} def={{} as any} />);
    expect(screen.getByRole('option', { name: 'Unknown (99)' })).toBeInTheDocument();
  });
});

describe('FlagsControl', () => {
  const flags = [{ bit: 1, label: 'A' }, { bit: 8, label: 'Sharable' }];
  it('toggles bits and preserves bits it does not know', async () => {
    const onChange = vi.fn();
    render(<FlagsControl {...base} value={0b10000001} onChange={onChange} type={{ kind: 'flags', flags }} def={{} as any} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sharable' }));
    expect(onChange).toHaveBeenCalledWith(0b10001001);
    await userEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    expect(onChange).toHaveBeenLastCalledWith(0b10000000);
    expect(screen.getByText(/unknown bits/i)).toBeInTheDocument();
  });
});

describe('MoneyControl', () => {
  it('splits copper into gold, silver and copper and back', async () => {
    const onChange = vi.fn();
    render(<MoneyControl {...base} value={12345} onChange={onChange} type={{ kind: 'money' }} def={{} as any} />);
    expect(screen.getByLabelText('Gold')).toHaveValue(1);
    expect(screen.getByLabelText('Silver')).toHaveValue(23);
    expect(screen.getByLabelText('Copper')).toHaveValue(45);
    await userEvent.clear(screen.getByLabelText('Gold')); await userEvent.type(screen.getByLabelText('Gold'), '2');
    expect(onChange).toHaveBeenLastCalledWith(22345);
  });
  it('supports negative amounts (the game deducts money)', () => {
    render(<MoneyControl {...base} value={-150} onChange={() => {}} type={{ kind: 'money' }} def={{} as any} />);
    expect(screen.getByText(/costs the player/i)).toBeInTheDocument();
  });
});

describe('IdRefControl and names', () => {
  const api = makeMockApi({ lookupNames: async (kind: string, ids: number[]) => okv(Object.fromEntries(ids.filter((i) => i === 25).map((i) => [i, 'Worn Shortsword']))) });
  const wrap = (ui: React.JSX.Element) => render(<NamesProvider api={api}>{ui}</NamesProvider>);
  it('shows the resolved name for a known id', async () => {
    wrap(<IdRefControl {...base} value={25} onChange={() => {}} type={{ kind: 'idRef', target: 'item' }} def={{} as any} />);
    expect(await screen.findByText('Worn Shortsword')).toBeInTheDocument();
  });
  it('warns when the id is not in the connected database', async () => {
    wrap(<IdRefControl {...base} value={999999} onChange={() => {}} type={{ kind: 'idRef', target: 'item' }} def={{} as any} />);
    expect(await screen.findByText(/not found in your database/i)).toBeInTheDocument();
  });
  it('shows no warning for zero or for kinds that cannot be looked up', async () => {
    wrap(<><IdRefControl {...base} id="a" label="A" value={0} onChange={() => {}} type={{ kind: 'idRef', target: 'item' }} def={{} as any} />
      <IdRefControl {...base} id="b" label="B" value={1234} onChange={() => {}} type={{ kind: 'idRef', target: 'spell' }} def={{} as any} /></>);
    await waitFor(() => expect(screen.queryByText(/not found/i)).toBeNull());
  });
  it('batches lookups into one call', async () => {
    const spy = vi.fn(async (_k: string, ids: number[]) => okv(Object.fromEntries(ids.map((i) => [i, `n${i}`]))));
    const a = makeMockApi({ lookupNames: spy as any });
    render(<NamesProvider api={a}><>{[1, 2, 3].map((n) => <IdRefControl key={n} {...base} id={`x${n}`} label={`X${n}`} value={n} onChange={() => {}} type={{ kind: 'idRef', target: 'item' }} def={{} as any} />)}</></NamesProvider>);
    await screen.findByText('n3');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('CreatureOrGoControl', () => {
  it('switches between creature and object and keeps the id', async () => {
    const onChange = vi.fn();
    render(<NamesProvider api={makeMockApi()}><CreatureOrGoControl {...base} value={{ target: 'creature', id: 7 }} onChange={onChange} type={{ kind: 'creatureOrGo' }} def={{} as any} /></NamesProvider>);
    await userEvent.selectOptions(screen.getByLabelText('Field type'), 'Object');
    expect(onChange).toHaveBeenCalledWith({ target: 'gameobject', id: 7 });
  });
});

describe('ListEditor', () => {
  const def: any = { shape: 'list', id: 'q.RewardChoiceItems', slots: 6, label: 'Choice rewards', help: '', group: 'rewards',
    members: [{ name: 'item', columnTemplate: 'I{n}', type: { kind: 'int' }, label: 'Item' }, { name: 'quantity', columnTemplate: 'Q{n}', type: { kind: 'int' }, label: 'Quantity' }] };
  const six = Array.from({ length: 6 }, (_, i) => ({ item: i + 1, quantity: 1 }));
  it('adds and removes entries', async () => {
    const onChange = vi.fn();
    render(<NamesProvider api={makeMockApi()}><ListEditor def={def} value={[{ item: 1, quantity: 1 }]} onChange={onChange} /></NamesProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith([{ item: 1, quantity: 1 }, { item: 0, quantity: 0 }]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Choice rewards 1' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
  it('blocks a seventh entry with a message', () => {
    render(<NamesProvider api={makeMockApi()}><ListEditor def={def} value={six} onChange={() => {}} /></NamesProvider>);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(screen.getByText(/at most 6/i)).toBeInTheDocument();
  });
});

describe('LongTextControl', () => {
  // NOTE (Task 22 implementer): per the HTML spec, HTMLTextAreaElement's `.value` getter always
  // normalizes CRLF/CR to LF (jsdom implements this identically to real browsers), so no textarea
  // can ever report `\r\n` back through `.value`. The brief's literal `\r\n` assertion is therefore
  // unpassable by construction; this test is adjusted to `\n` (verifying quotes and trailing spaces
  // survive verbatim, which is the part a control implementation actually controls) and reported
  // in the task report. Byte-exact CRLF round-tripping is guaranteed at the codec/export layer
  // (Tasks 3/11), not by the on-screen textarea widget.
  it('preserves quotes and trailing spaces exactly (line breaks are normalized by the DOM textarea)', async () => {
    const onChange = vi.fn();
    render(<LongTextControl {...base} value={"a\nb '  "} onChange={onChange} type={{ kind: 'text' }} def={{} as any} />);
    expect((screen.getByLabelText('Field') as HTMLTextAreaElement).value).toBe("a\nb '  ");
  });
  it('inserts a token at the end on request', async () => {
    const onChange = vi.fn();
    render(<LongTextControl {...base} value="Hello, " onChange={onChange} type={{ kind: 'text' }} def={{} as any} />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert $N (player name)' }));
    expect(onChange).toHaveBeenCalledWith('Hello, $N');
  });
});

describe('resolveControl', () => {
  it('maps every scalar kind to a control and refuses unknown shapes', () => {
    for (const type of [{ kind: 'int' }, { kind: 'float' }, { kind: 'string' }, { kind: 'text' }, { kind: 'enum', options: [] }, { kind: 'flags', flags: [] }, { kind: 'idRef', target: 'item' }, { kind: 'money' }, { kind: 'creatureOrGo' }] as const) {
      expect(resolveControl({ shape: 'scalar', id: 'x', table: 't', column: 'c', type, label: 'L', help: '', group: 'identity' } as any)).toBeTypeOf('function');
    }
    expect(() => resolveControl({ shape: 'scalar', type: { kind: 'bogus' } } as any)).toThrow(NoControlError);
  });
});
