import { useRef, useState } from 'react';
import type { Patrol } from '@core/entities/model';
import { waypointSettings, withWaypointSettings, type WaypointSettings } from '@core/world/waypoint-point';
import { trapTab } from '../components/trap-tab';
import { FacingField, PatrolPointFields } from './PatrolPointFields';
import { NumberField, SelectField } from '../scripts/fields';
import '../views/ProjectDialog.css';

/** One point of a route, as its dialog edits it: a project NPC's patrol, or a route the database has */
export type PointTarget =
  | { kind: 'patrol'; patrol: Patrol; index: number }
  | { kind: 'waypoint'; rest: Readonly<Record<string, string | null>>; index: number };

/** What Apply gives back: the patrol with the point changed, or the database point's columns */
export type PointResult = { kind: 'patrol'; patrol: Patrol } | { kind: 'waypoint'; rest: Record<string, string | null> };

const WALK = 0;
const RUN = 1;

/**
 * What an NPC does at one point of its route. A project NPC's point has its wait, pace, facing and
 * actions. A point of a route the database has has its wait, pace and facing (its
 * `waypoint_data` delay, move type and orientation); a waypoint script it runs is named, not edited.
 */
export function PointDialog({
  name,
  target,
  onApply,
  onClose,
}: {
  name: string;
  target: PointTarget;
  onApply(result: PointResult): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [patrol, setPatrol] = useState(target.kind === 'patrol' ? target.patrol : null);
  const [settings, setSettings] = useState<WaypointSettings | null>(target.kind === 'waypoint' ? waypointSettings(target.rest) : null);
  const title = `Point ${target.index + 1}`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Esc closes this dialog, not the 3D view round it
        data-selection="on"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>{title}</h2>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (patrol) onApply({ kind: 'patrol', patrol });
            else if (settings && target.kind === 'waypoint') onApply({ kind: 'waypoint', rest: withWaypointSettings(target.rest, settings) });
          }}
        >
          <p>What {name || 'this NPC'} does when it reaches this point of its route.</p>
          {patrol && <PatrolPointFields idPrefix={`point-${target.index}`} patrol={patrol} index={target.index} onChange={setPatrol} />}
          {settings && <WaypointFields settings={settings} onChange={setSettings} />}
          <div className="world3d__dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary">
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** A database route point's wait, pace and facing; another move type (landing, taking off) is kept as it is */
function WaypointFields({ settings, onChange }: { settings: WaypointSettings; onChange(next: WaypointSettings): void }): React.JSX.Element {
  const paces: (readonly [string, string])[] = [[String(WALK), 'Walk from here'], [String(RUN), 'Run from here']];
  if (settings.moveType !== WALK && settings.moveType !== RUN) paces.push([String(settings.moveType), `Move type ${settings.moveType}`]);
  return (
    <>
      <NumberField label="Wait (seconds)" value={settings.waitSecs} min={0} onChange={(waitSecs) => onChange({ ...settings, waitSecs: Math.max(0, waitSecs) })} />
      <SelectField label="Pace" value={String(settings.moveType)} options={paces} onChange={(v) => onChange({ ...settings, moveType: Number(v) })} />
      <FacingField facing={settings.facing} onChange={(facing) => onChange({ ...settings, facing })} />
      {settings.script > 0 && <p className="scene-hint">Runs waypoint script {settings.script} here, which is kept as it is.</p>}
    </>
  );
}
