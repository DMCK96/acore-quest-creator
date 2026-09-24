// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountBody } from './module-harness';
import { makeMockApi, okv } from './mock-api';
import { SCRIPTS_FIELD, writeScenes, type QuestScene } from '../../src/core/scripts/model';

const scene: QuestScene = {
  id: 's1', name: 'Totem', owner: { kind: 'creature', entry: 299 }, trigger: { kind: 'spellHit', spellId: 0 }, gates: [],
  steps: [{ kind: 'credit', objective: 1, group: false, waitMs: 0 }],
};
const lastScenes = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls.filter(([f]) => f === SCRIPTS_FIELD).at(-1)![1] as QuestScene[];

describe('Scripts module', () => {
  it('adds a scene from a preset, prefilled from the quest', async () => {
    const { onChange } = await mountBody('scripts', {
      creature_queststarter: [{ id: 240 }],
      'quest_template.RequiredNpcOrGo': [{ target: { target: 'creature', id: 299 }, count: 5 }],
    });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Start from' }), 'acceptSay');
    await userEvent.click(screen.getByRole('button', { name: 'Add scene' }));
    const scenes = lastScenes(onChange);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ id: 's1', owner: { kind: 'creature', entry: 240 }, trigger: { kind: 'questAccepted' } });
  });

  it('edits the trigger and steps of a scene', async () => {
    const { onChange } = await mountBody('scripts', { [SCRIPTS_FIELD]: writeScenes([scene]) });
    const card = screen.getByRole('group', { name: 'Scene: Totem' });
    await userEvent.selectOptions(within(card).getByRole('combobox', { name: 'When' }), 'dies');
    expect(lastScenes(onChange)[0]!.trigger).toEqual({ kind: 'dies' });
    await userEvent.selectOptions(within(card).getByRole('combobox', { name: 'Add step' }), 'say');
    expect(lastScenes(onChange)[0]!.steps.at(-1)).toMatchObject({ kind: 'say', waitMs: 0 });
  });

  it('only offers triggers the owner supports', async () => {
    await mountBody('scripts', { [SCRIPTS_FIELD]: writeScenes([{ ...scene, owner: { kind: 'gameobject', entry: 5 }, trigger: { kind: 'talkedTo' } }]) });
    const when = screen.getByRole('combobox', { name: 'When' });
    const options = within(when).getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(options).not.toContain('dies');
    expect(options).toContain('spellHit');
  });

  it('fills a position from pasted .gps output', async () => {
    const { onChange } = await mountBody('scripts', { [SCRIPTS_FIELD]: writeScenes([{ ...scene,
      steps: [{ kind: 'spawnNpc', entry: 1, at: { x: 0, y: 0, z: 0, o: 0 }, despawnAfterS: 60, attackPlayer: false, waitMs: 0 }] }]) });
    await userEvent.click(screen.getByLabelText('Paste .gps output'));
    await userEvent.paste('Map: 0 X: 1.5 Y: 2.5 Z: 3.5 Orientation: 1');
    expect(lastScenes(onChange)[0]!.steps[0]).toMatchObject({ at: { x: 1.5, y: 2.5, z: 3.5, o: 1 } });
  });

  it('lists scripts the tool did not write', async () => {
    const api = makeMockApi({ questScripts: async () => okv({ foreign: [{ ownerKind: 'creature', entry: 299, trigger: 'when it dies', steps: ['give kill credit'], combat: false }], unreadable: [], missingTables: [] }) });
    await mountBody('scripts', {}, { api });
    expect(await screen.findByText(/when it dies: give kill credit/)).toBeInTheDocument();
  });
});
