import { useEffect, useState } from 'react';
import type { GmCommand, TestCommands } from '@core/testing/gm';
import type { Api } from '@shared/ipc';

/** One command with a button that puts it on the clipboard, ready to paste into the game's chat. */
function CommandRow({ command }: { command: GmCommand }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(command.command);
      setCopied(true);
    } catch {
      // A sandbox without clipboard access still shows the command to copy by hand.
      setCopied(false);
    }
  }
  return (
    <li className="test-command">
      <span className="test-command__label">{command.label}</span>
      <code>{command.command}</code>
      <button type="button" className="entry-card__btn" aria-label={`Copy ${command.command}`} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </li>
  );
}

function Group({ title, commands }: { title: string; commands: readonly GmCommand[] }): React.JSX.Element | null {
  if (commands.length === 0) return null;
  return (
    <section>
      <h3 className="module-section__title">{title}</h3>
      <ul className="test-commands">
        {commands.map((c) => (
          <CommandRow key={c.command} command={c} />
        ))}
      </ul>
    </section>
  );
}

/** The commands to try the open quest in game once it has been applied to a dev server. */
export function TestInGameView({ api, questId }: { api: Api; questId: number }): React.JSX.Element {
  const [commands, setCommands] = useState<TestCommands | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.testCommands(questId).then((result) => {
      if (!live) return;
      if (result.ok) setCommands(result.value);
      else setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [api, questId]);

  if (error) return <p role="alert">{error}</p>;
  if (!commands) return <p className="scene-hint">Working out the commands…</p>;

  return (
    <div className="test-in-game">
      <p className="scene-hint">
        Apply the quest to your dev database first, then type these in the game's chat as a GM. Copy puts one on the clipboard.
      </p>
      <Group title="Reload after applying" commands={commands.reload} />
      {commands.restart.length > 0 && (
        <section>
          <h3 className="module-section__title">Needs a restart</h3>
          <ul className="test-commands">
            {commands.restart.map((r) => (
              <li key={r.reason}>{r.reason}</li>
            ))}
          </ul>
        </section>
      )}
      <Group title="Go there" commands={commands.go} />
      <Group title="Try it" commands={commands.quest} />
    </div>
  );
}
