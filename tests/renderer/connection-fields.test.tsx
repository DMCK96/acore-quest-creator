// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionFields } from '../../src/renderer/connection/ConnectionFields';
import { draftFromProfiles, type ConnectionDraft, type DraftErrors } from '../../src/renderer/connection/draft';

function Harness({ initial, errors = {}, browse = async () => null, onDraft }: {
  initial: ConnectionDraft; errors?: DraftErrors; browse?: () => Promise<string | null>; onDraft?: (d: ConnectionDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return <ConnectionFields draft={draft} errors={errors} browse={browse} onChange={(d) => { setDraft(d); onDraft?.(d); }} />;
}
const saved = draftFromProfiles([{ id: 1, name: 'World', role: 'world', host: 'h', port: 3306, user: 'u', database: 'd', dbcDir: '', clientDir: '', exportDir: '', lastConnectedAt: null }]);

describe('ConnectionFields', () => {
  it('edits the world fields under their exact labels', async () => {
    const onDraft = vi.fn();
    render(<Harness initial={draftFromProfiles([])} onDraft={onDraft} />);
    await userEvent.type(screen.getByLabelText('Host'), 'db.local');
    await userEvent.clear(screen.getByLabelText('Port'));
    await userEvent.type(screen.getByLabelText('Port'), '3307');
    await userEvent.type(screen.getByLabelText('Game client folder (optional)'), 'E:/WoW');
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ world: expect.objectContaining({ host: 'db.local', port: '3307', clientDir: 'E:/WoW', exportDir: '' }) }));
  });
  it('edits the export folder, and browses for it', async () => {
    const onDraft = vi.fn();
    render(<Harness initial={saved} onDraft={onDraft} browse={async () => 'D:/patches'} />);
    await userEvent.type(screen.getByLabelText('Export folder (optional)'), 'C:/sql');
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ world: expect.objectContaining({ exportDir: 'C:/sql' }) }));
    await userEvent.click(screen.getByRole('button', { name: 'Browse for the export folder' }));
    await waitFor(() => expect(screen.getByLabelText('Export folder (optional)')).toHaveValue('D:/patches'));
  });
  it('says a saved password is kept when left blank', () => {
    render(<Harness initial={saved} />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', 'Saved — leave blank to keep');
  });
  it('fills a folder from Browse', async () => {
    render(<Harness initial={saved} browse={async () => '/srv/data'} />);
    await userEvent.click(screen.getByRole('button', { name: 'Browse for the server data folder' }));
    await waitFor(() => expect(screen.getByLabelText('Server data folder (optional)')).toHaveValue('/srv/data'));
    expect(screen.getByLabelText('Game client folder (optional)')).toHaveValue('');
  });
  it('adds and removes the dev database', async () => {
    const onDraft = vi.fn();
    render(<Harness initial={saved} onDraft={onDraft} />);
    expect(screen.queryByLabelText('Dev host')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add a dev database' }));
    await userEvent.type(screen.getByLabelText('Dev host'), 'devhost');
    expect(screen.getByLabelText('Dev port')).toHaveValue('3306');
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ dev: expect.objectContaining({ host: 'devhost' }) }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove dev database' }));
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ dev: null }));
    expect(screen.getByRole('button', { name: 'Add a dev database' })).toBeInTheDocument();
  });
  it('shows each error beside its field', () => {
    render(<Harness initial={draftFromProfiles([])} errors={{ 'conn-host': 'Host is required' }} />);
    expect(screen.getByLabelText('Host')).toHaveAccessibleDescription(expect.stringContaining('Host is required'));
    expect(screen.getByLabelText('Host')).toHaveAttribute('aria-invalid', 'true');
  });
  it('disables every input while busy', () => {
    render(<ConnectionFields draft={saved} errors={{}} browse={async () => null} onChange={() => {}} disabled />);
    for (const label of ['Host', 'Port', 'User', 'Password', 'Database']) expect(screen.getByLabelText(label)).toBeDisabled();
  });
});
