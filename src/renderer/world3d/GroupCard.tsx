import type { GroupView } from '@shared/ipc';
import { equalShare } from '@core/world/groups';
import type { GroupDrawing } from './world3d';

/**
 * A group as the 3D view draws it: its spawn members (member groups are not spawns, so not
 * ringed), where each member that has a place stands, and the middle of those places.
 */
export function groupDrawingOf(view: GroupView): GroupDrawing {
  const members = view.members.flatMap((m) => {
    if (m.type !== 'spawn') return [];
    const [kind, guid] = m.key.split(':');
    return [{ kind: kind === 'object' ? ('object' as const) : ('creature' as const), guid: Number(guid) }];
  });
  const points = view.members.flatMap((m) => (m.at ? [{ ...m.at }] : []));
  const n = Math.max(1, points.length);
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y, z: s.z + p.z }), { x: 0, y: 0, z: 0 });
  return { centre: { x: sum.x / n, y: sum.y / n, z: sum.z / n }, members, points };
}

/** A percentage to at most 2 decimals, trailing zeros dropped */
const percent = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * The spawn group (pool) the selected spawn is in: its name, how many of its members are up at
 * once, and each member's chance (a 0-chance member gets an equal share of what is left).
 */
export function GroupCard({ view, onEdit, onClose }: { view: GroupView; onEdit?(): void; onClose(): void }): React.JSX.Element {
  const share = equalShare(view.members);
  return (
    <section className="world3d__group glass" aria-label="Spawn group">
      <header>
        <h3>{view.name}</h3>
        <button type="button" className="world3d__selected-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p>{`${view.maxActive} of ${view.members.length} at a time`}</p>
      {view.event && <p>{`${view.event.during ? 'Only during' : 'Except during'} ${view.event.name}`}</p>}
      <ul className="world3d__group-members">
        {view.members.map((m) => (
          <li key={m.key}>{m.chance === 0 ? `${m.name} · ${percent(share)}% (equal share)` : `${m.name} · ${percent(m.chance)}%`}</li>
        ))}
      </ul>
      {onEdit && (
        <p className="world3d__selected-actions">
          <button type="button" className="btn" onClick={onEdit}>
            Edit group…
          </button>
        </p>
      )}
    </section>
  );
}
