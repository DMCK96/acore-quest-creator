import { useState } from 'react';
import type { CustomObject } from '@core/entities/model';
import { EntityPicker } from '../../controls/EntityPicker';
import { NumberField } from '../../scripts/fields';
import { useApi } from '../../state/names';
import { LookLine } from '../LookLine';

/** How the object looks: taken from an existing object by name, browsed, or typed as an id. */
export function ObjectLook({ object, onChange }: { object: CustomObject; onChange(next: CustomObject): void }): React.JSX.Element {
  const api = useApi();
  const [from, setFrom] = useState(0);
  const [otherWays, setOtherWays] = useState(false);

  async function lookLike(entry: number): Promise<void> {
    setFrom(entry);
    if (!api || entry <= 0) return;
    const result = await api.entityTemplate('gameobject', entry);
    if (!result.ok || !result.value) return;
    const source = result.value as Partial<CustomObject>;
    onChange({ ...object, displayId: source.displayId ?? object.displayId, size: source.size ?? object.size });
  }

  return (
    <div className="scripts-body">
      <LookLine kind="objectDisplay" displayId={object.displayId} />
      <EntityPicker id={`obj-${object.entry}-look-like`} label="Look like…" kind="gameobject" value={from} onChange={(entry) => void lookLike(entry)} />
      <button type="button" className="entry-card__btn" aria-expanded={otherWays} onClick={() => setOtherWays((v) => !v)}>
        Other ways
      </button>
      {otherWays && (
        <div className="scene-section">
          <EntityPicker id={`obj-${object.entry}-browse`} label="Browse models" kind="objectDisplay" value={object.displayId}
            onChange={(displayId) => onChange({ ...object, displayId })} />
          <NumberField label="Display ID" value={object.displayId} min={0} onChange={(displayId) => onChange({ ...object, displayId: Math.round(displayId) })} />
        </div>
      )}
      <NumberField label="Size" value={object.size} onChange={(size) => onChange({ ...object, size })} />
    </div>
  );
}
