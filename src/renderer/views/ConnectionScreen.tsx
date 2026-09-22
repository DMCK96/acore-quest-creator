import { useState } from 'react';
import type { AppStore } from '../state/app-store';

export function ConnectionScreen({ store }: { store: AppStore }): React.JSX.Element {
  const error = store((s) => s.error);
  const profiles = store((s) => s.profiles);
  const connect = store((s) => s.connect);

  const [name, setName] = useState('');
  const [role, setRole] = useState<'world' | 'dev'>('world');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('3306');
  const [user, setUser] = useState('');
  const [database, setDatabase] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    void connect({ name, role, host, port: Number(port) || 0, user, database, password });
  };

  const prefill = (id: number): void => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setName(profile.name);
    setRole(profile.role);
    setHost(profile.host);
    setPort(String(profile.port));
    setUser(profile.user);
    setDatabase(profile.database);
    setPassword('');
  };

  return (
    <div>
      <h1>Connect to a world database</h1>
      {error && <div role="alert">{error}</div>}
      {profiles.length > 0 && (
        <ul>
          {profiles.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => prefill(p.id)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <label htmlFor="conn-name">Name</label>
        <input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} />

        <label htmlFor="conn-host">Host</label>
        <input id="conn-host" value={host} onChange={(e) => setHost(e.target.value)} />

        <label htmlFor="conn-port">Port</label>
        <input id="conn-port" value={port} onChange={(e) => setPort(e.target.value)} />

        <label htmlFor="conn-user">User</label>
        <input id="conn-user" value={user} onChange={(e) => setUser(e.target.value)} />

        <label htmlFor="conn-database">Database</label>
        <input id="conn-database" value={database} onChange={(e) => setDatabase(e.target.value)} />

        <label htmlFor="conn-password">Password</label>
        <input id="conn-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

        <button type="submit">Save and connect</button>
      </form>
    </div>
  );
}
