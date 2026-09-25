import { useRef } from 'react';
import './LongTextControl.css';
import type { ControlProps, FieldControl } from './types';

const TOKENS: readonly { token: string; description: string }[] = [
  { token: '$N', description: 'player name' },
  { token: '$C', description: 'class' },
  { token: '$R', description: 'race' },
  { token: '$B', description: 'line break' },
];

/**
 * Quest text marks line breaks with `$B` (or `$b`), which the client turns into new lines. Shown
 * raw, a whole story reads as one run-on line, so the textarea shows each `$B` as a real line break
 * and writes new lines back as the token the text already uses.
 *
 * Text that already holds raw line breaks is shown as it is: mapping it would turn those breaks
 * into `$B` on the first edit.
 */
function lineBreakToken(text: string): string | null {
  if (text.includes('\n') || text.includes('\r')) return null;
  return text.includes('$b') && !text.includes('$B') ? '$b' : '$B';
}

/** A textarea that keeps its value byte-for-byte, with buttons that insert quest-text tokens. */
export function LongTextControl(props: ControlProps<string | null>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = value ?? '';
  const breakToken = lineBreakToken(text);
  const shown = breakToken ? text.replace(/\$[Bb]/g, '\n') : text;

  function commit(next: string): void {
    onChange(breakToken ? next.replace(/\n/g, breakToken) : next);
  }

  function insert(token: string): void {
    const el = ref.current;
    const focused = !!el && document.activeElement === el;
    const start = focused && el!.selectionStart != null ? el!.selectionStart : shown.length;
    const end = focused && el!.selectionEnd != null ? el!.selectionEnd : start;
    commit(shown.slice(0, start) + token + shown.slice(end));
  }

  return (
    <div className="control">
      <label htmlFor={id} className="control__label">{label}</label>
      {help && <p className="control__help">{help}</p>}
      <textarea
        id={id}
        ref={ref}
        className="long-text"
        rows={6}
        value={shown}
        disabled={disabled}
        onChange={(e) => commit(e.target.value)}
      />
      <div className="control__actions">
        {TOKENS.map((t) => (
          <button key={t.token} type="button" className="btn btn--small" disabled={disabled} onClick={() => insert(t.token)}>
            {`Insert ${t.token} (${t.description})`}
          </button>
        ))}
      </div>
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

export const LongTextFieldControl = LongTextControl as unknown as FieldControl;
