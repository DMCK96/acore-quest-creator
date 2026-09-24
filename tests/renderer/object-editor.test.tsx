// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectEditor } from '../../src/renderer/entities/object/ObjectEditor';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv } from './mock-api';
import { newObject, type CustomObject } from '../../src/core/entities/model';
import type { Api } from '@shared/ipc';

let current: CustomObject = newObject(9100001);
function Live({ api, start }: { api: Api; start: CustomObject }) {
  const [o, setO] = useState(start);
  current = o;
  return <NamesProvider api={api}><ObjectEditor object={o} onChange={(n) => { current = n; setO(n); }} allocateSpawn={async () => 700} allocatePage={async () => 50} /></NamesProvider>;
}
const tab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));

describe('object editor', () => {
  it('shows Contents only for objects that hold pages or loot', async () => {
    const { rerender } = render(<Live api={makeMockApi()} start={{ ...newObject(9100001), type: 'generic' }} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Basics', 'Look', 'Placement']);
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Chest (can be looted)');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Basics', 'Look', 'Contents', 'Placement']);
    await tab('Contents');
    expect(screen.getByRole('button', { name: 'Add loot' })).toBeTruthy();
    rerender(<Live api={makeMockApi()} start={current} />);
  });

  it('takes the look of an existing object, or a browsed model', async () => {
    const api = makeMockApi({
      searchEntities: vi.fn(async (kind: string) => okv(kind === 'gameobject' ? [{ id: 2843, name: 'Battered Chest' }] : [{ id: 1, name: 'Chest02', detail: 'used by Battered Chest' }])),
      entityTemplate: vi.fn(async () => okv({ displayId: 1, size: 1.5 })),
    });
    render(<Live api={api} start={newObject(9100001)} />);
    await tab('Look');
    await userEvent.type(screen.getByRole('combobox', { name: 'Look like…' }), 'chest');
    await userEvent.click(await screen.findByRole('option', { name: /Battered Chest/ }));
    await waitFor(() => expect(current).toMatchObject({ displayId: 1, size: 1.5 }));
    await userEvent.click(screen.getByRole('button', { name: 'Other ways' }));
    expect(screen.getByRole('combobox', { name: 'Browse models' })).toBeTruthy();
    expect(screen.getByLabelText('Display ID')).toBeTruthy();
  });

  it('writes pages for a readable object', async () => {
    render(<Live api={makeMockApi()} start={{ ...newObject(9100001), type: 'text' }} />);
    await tab('Contents');
    await userEvent.click(screen.getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(current.pages).toEqual([{ id: 50, text: '' }]));
  });
});
