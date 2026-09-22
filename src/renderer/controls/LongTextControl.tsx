import { useRef } from 'react';
import type { ControlProps, FieldControl } from './types';

const TOKENS: readonly { token: string; description: string }[] = [
  { token: '$N', description: 'player name' },
  { token: '$C', description: 'class' },
  { token: '$R', description: 'race' },
  { token: '$B', description: 'line break' },
];

/** A textarea that keeps its value byte-for-byte, with buttons that insert quest-text tokens. */
export function LongTextControl(props: ControlProps<string | null>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = value ?? '';

  function insert(token: string): void {
    const el = ref.current;
    const focused = !!el && document.activeElement === el;
    const start = focused && el!.selectionStart != null ? el!.selectionStart : text.length;
    const end = focused && el!.selectionEnd != null ? el!.selectionEnd : start;
    onChange(text.slice(0, start) + token + text.slice(end));
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {help && <p>{help}</p>}
      <textarea
        id={id}
        ref={ref}
        value={text}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <div>
        {TOKENS.map((t) => (
          <button key={t.token} type="button" disabled={disabled} onClick={() => insert(t.token)}>
            {`Insert ${t.token} (${t.description})`}
          </button>
        ))}
      </div>
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const LongTextFieldControl = LongTextControl as unknown as FieldControl;
