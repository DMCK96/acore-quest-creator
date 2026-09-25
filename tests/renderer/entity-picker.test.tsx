// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider, useNameBook } from '../../src/renderer/state/names';
import { EntityPicker } from '../../src/renderer/controls/EntityPicker';
import { FactionSelect } from '../../src/renderer/controls/FactionSelect';
import { SkillSelect } from '../../src/renderer/controls/SkillSelect';
import { makeMockApi, okv, errv } from './mock-api';

const wolfNames = vi.fn(async (_kind: string, ids: number[]) =>
  okv(Object.fromEntries(ids.filter((i) => i === 299).map((i) => [i, 'Diseased Young Wolf']))));

function mount(value: number, api = makeMockApi({ lookupNames: wolfNames }), onChange = vi.fn()) {
  render(<NamesProvider api={api}><EntityPicker id="p" label="NPC" kind="creature" value={value} onChange={onChange} /></NamesProvider>);
  return { api, onChange };
}

describe('EntityPicker', () => {
  it('searches by name and picks a hit', async () => {
    const api = makeMockApi({
      lookupNames: wolfNames,
      searchEntities: vi.fn(async () => okv([{ id: 299, name: 'Diseased Young Wolf', detail: 'Level 1–2' }])),
    });
    const { onChange } = mount(0, api);
    await userEvent.type(screen.getByRole('combobox', { name: 'NPC' }), 'wolf');
    await userEvent.click(await screen.findByRole('option', { name: 'Diseased Young Wolf · Level 1–2 · #299' }));
    expect(onChange).toHaveBeenCalledWith(299);
    expect(api.searchEntities).toHaveBeenLastCalledWith('creature', 'wolf');
  });

  it('picks with the keyboard', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async () => okv([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])) });
    const { onChange } = mount(0, api);
    await userEvent.type(screen.getByRole('combobox', { name: 'NPC' }), 'x');
    await screen.findByRole('option', { name: 'B · #2' });
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('shows the chosen entity by name', async () => {
    mount(299);
    expect(await screen.findByDisplayValue('Diseased Young Wolf')).toBeInTheDocument();
    expect(screen.getByText('#299')).toBeInTheDocument();
  });

  it('keeps a stale id and says it is not in the database', async () => {
    const { onChange } = mount(4242);
    expect(await screen.findByText('#4242 not found in your database')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a failed search without changing the value', async () => {
    const api = makeMockApi({ searchEntities: vi.fn(async () => errv('QUERY', 'The world database refused a query')) });
    const { onChange } = mount(0, api);
    await userEvent.type(screen.getByRole('combobox', { name: 'NPC' }), 'wolf');
    expect(await screen.findByRole('alert')).toHaveTextContent('The world database refused a query');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops a search that answers after the picker closed', async () => {
    let answer: (v: unknown) => void = () => {};
    const searchEntities = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockImplementation(() => new Promise(() => {}));
    const { onChange } = mount(0, makeMockApi({ searchEntities }));
    const box = screen.getByRole('combobox', { name: 'NPC' });
    await userEvent.type(box, 'w');
    await waitFor(() => expect(searchEntities).toHaveBeenCalledTimes(1));
    await userEvent.tab();
    await act(async () => answer(okv([{ id: 299, name: 'Diseased Young Wolf' }])));
    await userEvent.type(box, 'x');
    expect(screen.queryByRole('option')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the choice', async () => {
    const { onChange } = mount(299);
    await screen.findByDisplayValue('Diseased Young Wolf');
    await userEvent.click(screen.getByRole('button', { name: 'Clear NPC' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe('FactionSelect and SkillSelect', () => {
  it('offers factions by name and keeps an unknown id', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FactionSelect id="f" label="Faction" value={0} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Faction' }), 'Argent Dawn');
    expect(onChange).toHaveBeenCalledWith(529);
    rerender(<FactionSelect id="f" label="Faction" value={123456} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Faction' })).toHaveDisplayValue('#123456');
  });
  it('offers skills by name', async () => {
    const onChange = vi.fn();
    render(<SkillSelect id="s" label="Skill" value={0} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Skill' }), 'Mining');
    expect(onChange).toHaveBeenCalledWith(186);
  });
});

describe('useNameBook', () => {
  it('fills in names as they load', async () => {
    function Probe() {
      const names = useNameBook();
      return <p>{names('creature', 299) ?? 'loading'}</p>;
    }
    render(<NamesProvider api={makeMockApi({ lookupNames: wolfNames })}><Probe /></NamesProvider>);
    expect(await screen.findByText('Diseased Young Wolf')).toBeInTheDocument();
  });
});

describe('new NPCs and objects made with the open quest', () => {
  // Edits reach the main process after a debounce, so its lookup does not know a just-made NPC yet.
  const nothingFound = vi.fn(async () => okv({}));

  it('names a new NPC instead of calling it missing', async () => {
    const api = makeMockApi({ lookupNames: nothingFound });
    render(
      <NamesProvider api={api} local={{ creature: new Map([[11000231, 'Foreman Brask']]), gameobject: new Map() }}>
        <EntityPicker id="p" label="NPC" kind="creature" value={11000231} onChange={vi.fn()} />
      </NamesProvider>,
    );
    expect(await screen.findByDisplayValue('Foreman Brask')).toBeInTheDocument();
    expect(screen.queryByText(/not found in your database/)).not.toBeInTheDocument();
  });

  it('follows a rename of the new NPC', async () => {
    const api = makeMockApi({ lookupNames: nothingFound });
    const picker = <EntityPicker id="p" label="NPC" kind="creature" value={11000231} onChange={vi.fn()} />;
    const { rerender } = render(
      <NamesProvider api={api} local={{ creature: new Map([[11000231, 'New NPC']]), gameobject: new Map() }}>{picker}</NamesProvider>,
    );
    expect(await screen.findByDisplayValue('New NPC')).toBeInTheDocument();
    rerender(
      <NamesProvider api={api} local={{ creature: new Map([[11000231, 'Foreman Brask']]), gameobject: new Map() }}>{picker}</NamesProvider>,
    );
    expect(await screen.findByDisplayValue('Foreman Brask')).toBeInTheDocument();
  });

  it('names a new object, and gives it to the name book too', async () => {
    function Probe() {
      const names = useNameBook();
      return <p>{names('gameobject', 9000150) ?? 'loading'}</p>;
    }
    render(
      <NamesProvider api={makeMockApi({ lookupNames: nothingFound })} local={{ creature: new Map(), gameobject: new Map([[9000150, "Brask's Ledger"]]) }}>
        <Probe />
      </NamesProvider>,
    );
    expect(await screen.findByText("Brask's Ledger")).toBeInTheDocument();
  });

  it('still asks the database for everything else', async () => {
    const api = makeMockApi({ lookupNames: wolfNames });
    render(
      <NamesProvider api={api} local={{ creature: new Map([[11000231, 'Foreman Brask']]), gameobject: new Map() }}>
        <EntityPicker id="p" label="NPC" kind="creature" value={299} onChange={vi.fn()} />
      </NamesProvider>,
    );
    expect(await screen.findByDisplayValue('Diseased Young Wolf')).toBeInTheDocument();
  });
});
