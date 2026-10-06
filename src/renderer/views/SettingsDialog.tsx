import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../state/app-store';
import { trapTab } from '../components/trap-tab';
import { SETTINGS_SECTIONS } from './settings/sections';
import './ProjectDialog.css';
import './SettingsDialog.css';

/**
 * The Settings modal over the canvas: a tab per section (the connection, the preferences). Every
 * section stays mounted, so edits in one survive a look at another. A section mid-save reports it
 * busy and the dialog will not close or change tab until it is done: closing would lose a failure
 * nobody else shows.
 */
export function SettingsDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = (): void => {
    if (!busy) onClose();
  };

  // Focus moves in on opening and back to what opened it (the settings button) on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Caught before anything else hears it: the quest editor behind also closes on Escape.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, busy]);

  // Saving disables the fields, which drops focus out of the dialog: take it back when done.
  useEffect(() => {
    if (!busy && dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus();
  }, [busy]);

  /** Left and right move between the tabs (and choose the one moved to), as tabs do */
  const onTabKey = (e: React.KeyboardEvent, index: number): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : SETTINGS_SECTIONS.length - 1)) % SETTINGS_SECTIONS.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialog}
        className="conn-card settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, dialog.current)}
      >
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map(({ id, title }, index) => (
            <button
              key={id}
              ref={(el) => {
                tabs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-controls={`settings-panel-${id}`}
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              className="settings-tabs__tab"
              disabled={busy}
              onClick={() => setActive(index)}
              onKeyDown={(e) => onTabKey(e, index)}
            >
              {title}
            </button>
          ))}
        </div>
        {SETTINGS_SECTIONS.map(({ id, Component }, index) => (
          <div key={id} role="tabpanel" id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} hidden={active !== index}>
            <Component store={store} onClose={onClose} setBusy={setBusy} />
          </div>
        ))}
      </div>
    </div>
  );
}
