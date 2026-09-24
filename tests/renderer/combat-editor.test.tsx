// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountEditor } from './module-harness';
import { makeMockApi, okv } from './mock-api';
import { ENTITIES_FIELD, newNpc, writeEntities, type QuestEntities } from '../../src/core/entities/model';
import { emptyFight, newAbility, type Fight } from '../../src/core/combat/model';

// Module bodies render from props and never re-render themselves, so each state is mounted directly.
const last = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.filter(([f]) => f === ENTITIES_FIELD).at(-1)![1] as QuestEntities;
const withFight = (fight: Fight | null): QuestEntities => ({ npcs: [{ ...newNpc(12000001), name: 'Hela', fight }], objects: [] });
const frostbolt = { id: 116, name: 'Frostbolt', rank: 'Rank 1', castMs: 1300, cooldownMs: 0, rangeYd: 30, school: 'Frost', kind: 'harmful' as const };
const frenzy = { id: 8269, name: 'Frenzy', rank: '', castMs: 0, cooldownMs: 0, rangeYd: null, school: 'Physical', kind: 'helpful' as const };
const spellApi = () => makeMockApi({
  spellFacts: vi.fn(async (ids: number[]) => okv({ available: true, spells: Object.fromEntries([frostbolt, frenzy].filter((s) => ids.includes(s.id)).map((s) => [s.id, s])) })),
  searchEntities: vi.fn(async (kind: string, text: string) => okv(kind === 'spell'
    ? [frenzy, frostbolt].filter((s) => s.name.toLowerCase().includes(text.toLowerCase())).map((s) => ({ id: s.id, name: s.name, detail: s.school }))
    : [])),
  lookupNames: vi.fn(async (_k: string, ids: number[]) => okv(Object.fromEntries(ids.filter((i) => i === 116 || i === 8269).map((i) => [i, i === 116 ? 'Frostbolt (Rank 1)' : 'Frenzy'])))),
});
const fightRegion = () => screen.getByRole('region', { name: 'Fight' });

describe('Fight editor', () => {
  it('shows that an NPC without a fight just attacks, and starts one from a preset or from scratch', async () => {
    const onChange = vi.fn();
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(withFight(null)) }, { kind: 'npc', entry: 12000001, isNew: false }, { onChange, api: spellApi(), tab: 'Fight' });
    expect(within(fightRegion()).getByText('This NPC just attacks (no abilities).')).toBeTruthy();
    await userEvent.selectOptions(within(fightRegion()).getByLabelText('Start from a preset'), 'Flee at 15%');
    expect(last(onChange).npcs[0]!.fight!.reactions[0]).toMatchObject({ when: { kind: 'healthBelow', pct: 15 } });
    await userEvent.click(within(fightRegion()).getByRole('button', { name: 'Give it a fight' }));
    expect(last(onChange).npcs[0]!.fight!.abilities).toHaveLength(1);
  });

  it('picks a spell by name and saves it with the target its effect suggests', async () => {
    const onChange = vi.fn();
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(withFight({ ...emptyFight(), abilities: [newAbility(emptyFight())] })) }, { kind: 'npc', entry: 12000001, isNew: false }, { onChange, api: spellApi(), tab: 'Fight' });
    const ability = within(fightRegion()).getByRole('group', { name: 'Ability 1' });
    await userEvent.type(within(ability).getByRole('combobox', { name: 'Spell' }), 'Frenzy');
    await userEvent.click(await within(ability).findByRole('option', { name: /Frenzy/ }));
    await waitFor(() => expect(last(onChange).npcs[0]!.fight!.abilities[0]).toMatchObject({ spellId: 8269, target: 'self' }));
  });

  it('shows the summary in plain words with spell names', async () => {
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(withFight({ ...emptyFight(), abilities: [{ ...newAbility(emptyFight()), spellId: 116 }] })) }, { kind: 'npc', entry: 12000001, isNew: false }, { api: spellApi(), tab: 'Fight' });
    expect(await screen.findByText('Casts Frostbolt on its current target every 8–12 s (first after 2–4 s)')).toBeTruthy();
  });

  it('adds phases when a reaction goes to a new phase, and then shows the phase controls', async () => {
    const onChange = vi.fn();
    const start: Fight = {
      ...emptyFight(),
      abilities: [{ ...newAbility(emptyFight()), spellId: 116 }],
      reactions: [{ id: 'r1', when: { kind: 'healthBelow', pct: 50 }, phases: [], steps: [] }],
    };
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(withFight(start)) }, { kind: 'npc', entry: 12000001, isNew: false }, { onChange, api: spellApi(), tab: 'Fight' });
    expect(within(fightRegion()).queryByRole('group', { name: 'Phases' })).toBeNull();
    const reaction = within(fightRegion()).getByRole('group', { name: 'Reaction 1' });
    await userEvent.selectOptions(within(reaction).getByLabelText('Add step'), 'Go to phase');
    const saved = last(onChange);
    expect(saved.npcs[0]!.fight!.phases).toEqual(['Phase 1', 'Phase 2']);
    expect(saved.npcs[0]!.fight!.reactions[0]!.steps).toEqual([{ kind: 'goToPhase', phase: 2, waitMs: 0 }]);

    cleanup();
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(saved) }, { kind: 'npc', entry: 12000001, isNew: false }, { api: spellApi(), tab: 'Fight' });
    expect(within(fightRegion()).getByRole('group', { name: 'Phases' })).toBeTruthy();
    expect(within(within(fightRegion()).getByRole('group', { name: 'Ability 1' })).getByText('In phases')).toBeTruthy();
  });

  it('refuses to remove a phase that is still used and says where', async () => {
    const onChange = vi.fn();
    const f: Fight = { phases: ['Ground', 'Air'], abilities: [{ ...newAbility(emptyFight()), spellId: 116, phases: [2] }], reactions: [] };
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(withFight(f)) }, { kind: 'npc', entry: 12000001, isNew: false }, { onChange, api: spellApi(), tab: 'Fight' });
    const phases = within(fightRegion()).getByRole('group', { name: 'Phases' });
    await userEvent.click(within(phases).getByRole('button', { name: 'Remove Air' }));
    expect(within(phases).getByText('Air is still used by Ability 1.')).toBeTruthy();
    expect(onChange.mock.calls.filter(([k]) => k === ENTITIES_FIELD)).toHaveLength(0);
  });

  it('moves a cast on the hurt friend back to the current target when the reaction stops being about a hurt friend', async () => {
    const onChange = vi.fn();
    const f: Fight = { ...emptyFight(), reactions: [{ id: 'r1', when: { kind: 'friendHealthBelow', pct: 40, range: 30 }, phases: [], steps: [{ kind: 'cast', spellId: 2054, target: 'hurtFriend', waitMs: 0 }] }] };
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(withFight(f)) }, { kind: 'npc', entry: 12000001, isNew: false }, { onChange, api: spellApi(), tab: 'Fight' });
    const reaction = within(fightRegion()).getByRole('group', { name: 'Reaction 1' });
    await userEvent.selectOptions(within(reaction).getByLabelText('When'), 'At a health %');
    expect(last(onChange).npcs[0]!.fight!.reactions[0]!.steps[0]).toMatchObject({ kind: 'cast', target: 'victim' });
  });

  it('falls back to a spell ID when there is no server data folder', async () => {
    const onChange = vi.fn();
    const api = makeMockApi({ spellFacts: vi.fn(async () => okv({ available: false, reason: 'Spell names need the server data folder.', spells: {} })) });
    await mountEditor({ [ENTITIES_FIELD]: writeEntities(withFight({ ...emptyFight(), abilities: [newAbility(emptyFight())] })) }, { kind: 'npc', entry: 12000001, isNew: false }, { onChange, api, tab: 'Fight' });
    const ability = within(fightRegion()).getByRole('group', { name: 'Ability 1' });
    expect(await within(ability).findByText('Spell names need the server data folder.')).toBeTruthy();
    fireEvent.change(within(ability).getByLabelText('Spell ID'), { target: { value: '116' } });
    expect(last(onChange).npcs[0]!.fight!.abilities[0]!.spellId).toBe(116);
  });
});
