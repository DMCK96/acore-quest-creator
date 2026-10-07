import { MARKER_KINDS, type WorldMarker } from './quest-markers';

/** The quest marker picked in the view: what it is, where it is, and what its last move said. */
export function MarkerCard({ marker, note, onClose }: { marker: WorldMarker; note: string | null; onClose(): void }): React.JSX.Element {
  return (
    <section className="world3d__selected" aria-label="Selected quest position">
      <header>
        <h3>{marker.label}</h3>
        <button type="button" className="world3d__selected-close" aria-label="Clear selection" onClick={onClose}>
          ×
        </button>
      </header>
      <p>
        {MARKER_KINDS[marker.kind]}
        {marker.radius ? ` · ${marker.radius} yd radius` : ''}
      </p>
      <p className="world3d__selected-place">
        X {marker.x.toFixed(2)} · Y {marker.y.toFixed(2)}
        {marker.kind !== 'poi' && ` · Z ${marker.z.toFixed(2)}`}
      </p>
      <p>{marker.draggable ? 'Drag its handles to move it.' : 'Edit its points in the quest’s POI fields.'}</p>
      {marker.note && <p>{marker.note}</p>}
      {note && <p className="world3d__selected-note">{note}</p>}
      <p className="world3d__selected-actions">
        <button type="button" className="btn" onClick={onClose}>
          Deselect
        </button>
      </p>
    </section>
  );
}
