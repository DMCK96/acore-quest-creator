import { useMemo, useRef } from 'react';
import type { ProjectEntities } from '@core/entities/model';
import { moveMarker } from '@core/map/positions';
import type { FieldValue } from '@core/registry/types';
import type { StepPlace } from '@shared/ipc';
import { markersOnMap, worldMarkers, type WorldMarker } from './quest-markers';

type At = { x: number; y: number; z: number };

/**
 * The open quest's markers for the World: those on the map shown, and a drag of one stored as one step of
 * the project's history, through the quest's field or the project's NPCs (a fight's summon point), as the
 * quest map stored it.
 */
export function useQuestMarkers({ values, entities, map, change, setEntities, runStep }: {
  /** The open quest's values as last changed (null with no quest open: no markers) */
  values: { readonly current: Readonly<Record<string, unknown>> | undefined };
  /** The project's NPCs and objects as last changed */
  entities: { readonly current: ProjectEntities };
  map: number;
  change(fieldId: string, value: FieldValue): void;
  setEntities(next: ProjectEntities): void;
  runStep(work: () => Promise<void>, label?: string, where?: StepPlace): Promise<void>;
}): {
  /** Every marker of the open quest */
  all: WorldMarker[];
  /** Those drawn on the map shown */
  shown: WorldMarker[];
  move(id: string, to: At): void;
} {
  const current = values.current;
  const store = entities.current;
  const all = useMemo(() => (current ? worldMarkers(current, store) : []), [current, store]);
  const shown = useMemo(() => markersOnMap(all, map), [all, map]);
  const allRef = useRef(all);
  allRef.current = all;
  const mapRef = useRef(map);
  mapRef.current = map;

  const move = (id: string, to: At): void => {
    const label = allRef.current.find((m) => m.id === id)?.label ?? 'a quest position';
    void runStep(async () => {
      const now = values.current;
      const edit = now ? moveMarker(now, entities.current, id, to) : null;
      if (!edit) return;
      if ('entities' in edit) setEntities(edit.entities);
      else change(edit.field, edit.value);
    }, `Moved ${label}`, { map: mapRef.current, ...to });
  };

  return { all, shown, move };
}
