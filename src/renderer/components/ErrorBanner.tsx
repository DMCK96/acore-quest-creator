import type { AppStore } from '../state/app-store';
import './ErrorBanner.css';

/**
 * The one place every API failure past the connection screen becomes visible.
 *
 * `store.error` used to be rendered only by the connection screen and the transient `QuestPicker`, so
 * an exhausted ID range, an ID collision, a dropped connection or a failed edit save happened in
 * silence once the canvas was up. This sits above the canvas for both the `pick` and `edit`
 * screens, so wherever the user is, the failure is shown and can be dismissed.
 */
export function ErrorBanner({ store }: { store: AppStore }): React.JSX.Element | null {
  const error = store((s) => s.error);
  const dismissError = store((s) => s.dismissError);
  if (error === null) return null;
  return (
    <div role="alert" className="error-banner">
      <span className="error-banner__icon" aria-hidden="true">
        !
      </span>
      <span className="error-banner__message">{error}</span>
      <button type="button" className="btn error-banner__dismiss" onClick={dismissError}>
        Dismiss
      </button>
    </div>
  );
}
