import type { FormHTMLAttributes, Ref } from 'react';
import { ConnectionFields } from './ConnectionFields';
import type { ConnectionDraft, DraftErrors } from './draft';
import './ConnectionCard.css';

/**
 * The connection details on a frosted card: a title, the error, the fields (two columns when there
 * is room) and one full-width button. The login screen shows it over the orb, Settings over the
 * canvas; only the words, the button and Settings' close button differ.
 */
export function ConnectionCard({
  title,
  titleId,
  subtitle,
  error,
  note,
  submitLabel,
  submitDisabled = false,
  busy,
  onClose,
  draft,
  onChange,
  errors,
  browse,
  formRef,
  ...form
}: {
  title: string;
  titleId?: string;
  subtitle: string;
  error: string | null;
  /** A line above the button, e.g. what saving will do. */
  note?: string | null;
  submitLabel: string;
  submitDisabled?: boolean;
  busy: boolean;
  /** Shows a close button in the corner. */
  onClose?: () => void;
  draft: ConnectionDraft;
  onChange: (draft: ConnectionDraft) => void;
  errors: DraftErrors;
  browse: () => Promise<string | null>;
  formRef?: Ref<HTMLFormElement>;
} & Omit<FormHTMLAttributes<HTMLFormElement>, 'title' | 'onChange'>): React.JSX.Element {
  return (
    <form ref={formRef} className="conn-card" noValidate aria-busy={busy || undefined} {...form}>
      <div className="conn-card__header">
        <h1 id={titleId} className="conn-card__title">
          {title}
        </h1>
        <p className="conn-card__subtitle">{subtitle}</p>
        {onClose && (
          <button type="button" className="btn btn--icon conn-card__close" aria-label="Close" onClick={onClose} disabled={busy}>
            ✕
          </button>
        )}
      </div>
      {error && (
        <p className="conn-card__error" role="alert">
          {error}
        </p>
      )}
      <ConnectionFields draft={draft} onChange={onChange} errors={errors} disabled={busy} browse={browse} />
      {note && <p className="conn-card__note">{note}</p>}
      <button type="submit" className="btn btn--primary conn-card__submit" disabled={busy || submitDisabled}>
        {submitLabel}
      </button>
    </form>
  );
}
