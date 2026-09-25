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
    <div className="control">
      <label htmlFor={id} className="control__label">{label}</label>
      {help && <p className="control__help">{help}</p>}
      <input id={id} value={text} disabled={disabled} onChange={(e) => handleChange(e.target.value)} />
      {readOnlyReason && <p role="alert" className="control__alert">{readOnlyReason}</p>}
    </div>
  );
}

export const TextFieldControl = TextControl as unknown as FieldControl;
