// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
