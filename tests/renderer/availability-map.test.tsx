// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ModuleId } from '@core/modules/model';
import { describeCondition } from '../../src/renderer/groups/conditions';
import { mountBody } from './module-harness';
import { makeMockApi, okv } from './mock-api';

const api = makeMockApi({ lookupNames: async (_k: string, ids: number[]) => okv(Object.fromEntries(ids.map((i) => [i, `Name ${i}`]))) });
async function mount(module: ModuleId, over: Record<string, any> = {}, onChange = vi.fn()) {
  await mountBody(module, over, { api, onChange });
  return onChange;
}

describe('describeCondition', () => {
  const row = (t: number, v1: number, neg = 0) => ({ ConditionTypeOrReference: t, ConditionValue1: v1, ConditionValue2: 0, ConditionValue3: 0, NegativeCondition: neg });
  it('describes the quest-state conditions in plain language', () => {
    expect(describeCondition(row(8, 60000))).toBe('The player has been rewarded quest 60000');
    expect(describeCondition(row(9, 5))).toBe('The player currently has quest 5');
    expect(describeCondition(row(14, 5))).toBe('The player has never taken quest 5');
    expect(describeCondition(row(28, 5))).toBe('The player has completed quest 5 but not turned it in');
  });
  it('inverts with NegativeCondition and falls back for unknown types', () => {
    expect(describeCondition(row(8, 60000, 1))).toBe('The player has NOT been rewarded quest 60000');
    expect(describeCondition({ ...row(999, 1), ConditionValue2: 2, ConditionValue3: 3 })).toBe('Condition type 999 (values 1, 2, 3)');
  });
});

describe('Quest Giver module', () => {
  it('shows who offers and who takes in the quest with resolved names', async () => {
    await mount('giver', { creature_queststarter: [{ id: 100 }], creature_questender: [{ id: 200 }] });
    expect(await screen.findByDisplayValue('Name 100')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Name 200')).toBeInTheDocument();
  });
  it('adds a starter creature', async () => {
    const onChange = await mount('giver', { creature_queststarter: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Add quest giver' }));
    expect(onChange).toHaveBeenCalledWith('creature_queststarter', [{ id: 0 }]);
  });
});

describe('Objectives module', () => {
  it('lists the area triggers that complete the quest', async () => {
    await mount('objectives', { areatrigger_involvedrelation: [{ id: 77 }] });
    expect(screen.getByLabelText('Area trigger ID 1')).toHaveValue('77');
  });
});

describe('Advanced module', () => {
  it('shows conditions as sentences and keeps the raw columns editable', async () => {
    await mount('advanced', { conditions: [{ SourceGroup: 0, SourceId: 0, ElseGroup: 0, ConditionTypeOrReference: 8, ConditionTarget: 0, ConditionValue1: 60000, ConditionValue2: 0, ConditionValue3: 0, NegativeCondition: 0, ErrorType: 0, ErrorTextId: 0, ScriptName: '', Comment: null }] });
    expect(screen.getByText('The player has been rewarded quest 60000')).toBeInTheDocument();
  });
});

describe('Chain module', () => {
  it('names the chain fields in plain words', async () => {
    await mount('chain');
    expect(screen.getByRole('combobox', { name: 'Previous quest' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Next quest' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Exclusive group/i)).toBeInTheDocument();
  });
});

describe('Map marker module', () => {
  it('auto-assigns the next POI id and the next point index', async () => {
    const onChange = await mount('mapMarker', {
      quest_poi: [{ id: 1, ObjectiveIndex: 0, MapID: 0, WorldMapAreaId: 0, Floor: 0, Priority: 0, Flags: 0, VerifiedBuild: 0 }],
      quest_poi_points: [{ Idx1: 1, Idx2: 0, X: 1, Y: 2, VerifiedBuild: 0 }, { Idx1: 1, Idx2: 1, X: 3, Y: 4, VerifiedBuild: 0 }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Add POI' }));
    expect(onChange).toHaveBeenCalledWith('quest_poi', [expect.anything(), expect.objectContaining({ id: 2 })]);
    await userEvent.click(screen.getByRole('button', { name: 'Add point' }));
    expect(onChange).toHaveBeenCalledWith('quest_poi_points', [expect.anything(), expect.anything(), expect.objectContaining({ Idx1: 1, Idx2: 2 })]);
  });
});
