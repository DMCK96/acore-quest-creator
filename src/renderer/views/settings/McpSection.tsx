import { useEffect, useState } from 'react';
import type { McpStatus } from '@shared/ipc';
import type { SettingsSectionProps } from './sections';

const copy = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The clipboard can be blocked; the text is on screen to select.
  }
};

/** The command that adds this server to Claude Code (one client among many; the address and token work in any). */
const addCommand = (s: McpStatus): string => `claude mcp add --transport http awe ${s.url} --header "Authorization: Bearer ${s.token}"`;

/** Lets an AI assistant connected over MCP work in the open project. Off until switched on; each change applies at once. */
export function McpSection(_props: SettingsSectionProps): React.JSX.Element {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [port, setPort] = useState('47600');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = (next: McpStatus): void => {
    setStatus(next);
    setPort(String(next.port));
    setError(next.error);
  };

  useEffect(() => {
    // Every tab stays mounted, and tests render the dialog without the preload bridge
    void window.api?.mcpStatus().then((r) => (r.ok ? adopt(r.value) : setError(r.error.message)));
  }, []);

  const configure = async (enabled: boolean, wanted: number, wikiLookups: boolean = status?.wikiLookups ?? false): Promise<void> => {
    const r = await window.api.mcpConfigure({ enabled, port: wanted, wikiLookups });
    if (r.ok) adopt(r.value);
    else setError(r.error.message);
  };

  const commitPort = (): void => {
    if (!status) return;
    const wanted = Number(port);
    if (wanted === status.port) return;
    void configure(status.enabled, wanted);
  };

  const regenerate = async (): Promise<void> => {
    const r = await window.api.mcpRegenerateToken();
    if (r.ok) adopt(r.value);
    else setError(r.error.message);
  };

  return (
    <div className="settings-prefs">
      <h2 className="settings-prefs__heading">MCP / AI</h2>
      <p className="settings-mcp__note">
        Lets an AI assistant on this computer (any MCP client) read the world and edit the open project. Its edits appear in History as "AI: …" and can be undone. The world database is never written.
      </p>
      <label className="settings-prefs__choice">
        <input type="checkbox" checked={status?.enabled ?? false} disabled={status === null} onChange={(e) => void configure(e.target.checked, Number(port))} />
        Allow AI to edit this project
      </label>
      <label className="settings-prefs__choice">
        Port
        <input
          type="number"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          onBlur={commitPort}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPort();
          }}
        />
      </label>
      <label className="settings-prefs__choice">
        <input
          type="checkbox"
          checked={status?.wikiLookups ?? false}
          disabled={status === null}
          onChange={(e) => void configure(status?.enabled ?? false, Number(port), e.target.checked)}
        />
        Allow lookups on warcraft.wiki.gg
      </label>
      <p className="settings-mcp__note">The assistant can search and read pages on warcraft.wiki.gg. Only the text it searches for is sent; nothing else leaves this computer.</p>
      {error !== null && (
        <p role="alert" className="settings-mcp__error">
          {error}
        </p>
      )}
      {status?.running && (
        <div className="settings-mcp__connect">
          <div>
            Address <code>{status.url}</code>
            <button type="button" onClick={() => void copy(status.url)}>
              Copy address
            </button>
          </div>
          <div>
            Token {showToken ? <code>{status.token}</code> : <code aria-hidden="true">••••••••••••</code>}
            <button type="button" onClick={() => setShowToken((s) => !s)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
            <button type="button" onClick={() => void copy(status.token)}>
              Copy token
            </button>
          </div>
          <div>
            <button type="button" onClick={() => void copy(addCommand(status))}>
              Copy Claude Code command
            </button>
            <button type="button" onClick={() => void regenerate()}>
              Make a new token
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
