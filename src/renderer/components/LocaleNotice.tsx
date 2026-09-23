import { fieldsOfGroup } from '@core/registry';
import type { EditorGroup } from '@core/registry/types';
import type { OpenResult } from '@shared/ipc';

/**
 * Spec §4.3: the `*_locale` tables round-trip verbatim and this slice never writes them, so an
 * edit to the English text leaves every translation saying the old thing. That is invisible in the
 * editor, so it is said here, on the group whose text the user actually changed.
 *
 * `open.importedText` is what the last import read, not what the edit holds, so the notice is
 * right even for a quest edited in an earlier session.
 */
export function LocaleNotice({ open, group }: { open: OpenResult; group: EditorGroup }): React.JSX.Element | null {
  if (open.locales.length === 0) return null;

  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed = fieldsOfGroup(group)
    .filter((f) => Object.prototype.hasOwnProperty.call(open.importedText, f.id))
    .filter((f) => !same(open.aggregate.values[f.id], open.importedText[f.id]))
    .map((f) => f.label);
  if (changed.length === 0) return null;

  const many = changed.length > 1;
  return (
    <p role="note" data-testid="locale-notice" className="locale-notice">
      {`Translations are not updated: ${changed.join(', ')} ${many ? 'have' : 'has'} changed, but this quest's ` +
        `${open.locales.join(', ')} text stays exactly as it is, so a localized client keeps showing the old wording.`}
    </p>
  );
}
