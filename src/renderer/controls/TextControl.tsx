import type { ControlProps, FieldControl } from './types';
import { useLocalText } from './useLocalText';

export function TextControl(props: ControlProps<string | null>): React.JSX.Element {
  const { id, label, help, value, onChange, disabled, readOnlyReason } = props;
  const { text, setText, commit } = useLocalText(value, (v) => v ?? '');

  function handleChange(raw: string): void {
    setText(raw);
    commit(raw);
    onChange(raw);
  }

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {help && <p>{help}</p>}
      <input id={id} value={text} disabled={disabled} onChange={(e) => handleChange(e.target.value)} />
      {readOnlyReason && <p role="alert">{readOnlyReason}</p>}
    </div>
  );
}

export const TextFieldControl = TextControl as unknown as FieldControl;
