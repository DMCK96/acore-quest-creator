import { useEffect, useRef, useState } from 'react';
import { readEntities, type CustomNpc, type Patrol, type Spawn } from '@core/entities/model';
import { chooseZ, floorCandidates } from '@core/map/floors';
import { addPoint, insertPoint, nearestSegment, newPatrol, patrolOf, setPatrol } from '@core/map/patrol';
import type { FieldValue } from '@core/registry/types';
import type { Api } from '@shared/ipc';

type Values = Readonly<Record<string, unknown>>;
type FloorResult = { floors: number[]; ground: number | null };
type Floors = (map: number, x: number, y: number) => Promise<{ result: FloorResult | null; reason: string | null }>;

export interface PatrolTarget {
  entry: number;
  guid: number;
}

export interface ActivePatrol extends PatrolTarget {
  npc: CustomNpc;
  spawn: Spawn;
  patrol: Patrol | null;
  /** The route's id on the map and the prefix of its points' marker ids. */
  routeId: string;
}

/**
 * Drawing one new NPC spawn's patrol on the quest map: getting its path id, adding a point per
 * click (on the floor nearest the point before), inserting one on a clicked segment, and leaving the
 * mode when the spawn goes away. Every edit is built from the values as they are when it lands.
 */
export function usePatrolMode(input: {
  api: Api | null;
  target: PatrolTarget | null;
  values: Values;
  valuesRef: { current: Values };
  onChange(fieldId: string, value: FieldValue): void;
  floorsAt: Floors;
  currentMap: number;
  mapName(map: number): string;
  onLeave(message: string | null): void;
  onEnter(spawn: Spawn): void;
  /** The floors found under a point just added, so the map can offer the others or say why there are none. */
  onFloors(markerId: string, at: { x: number; y: number }, candidates: number[], reason: string | null): void;
}) {
  const { api, target, values, valuesRef, onChange, floorsAt, currentMap, mapName, onLeave, onEnter, onFloors } = input;
  const [selected, setSelected] = useState<number | null>(null);
  const [picking, setPicking] = useState<'facing' | 'object' | null>(null);
  const asked = useRef<string | null>(null);
  const entered = useRef<string | null>(null);

  const npc = target ? readEntities(values).npcs.find((n) => n.entry === target.entry) : undefined;
  const spawn = target ? npc?.spawns.find((s) => s.guid === target.guid) : undefined;
  const active: ActivePatrol | null =
    target && npc && spawn ? { ...target, npc, spawn, patrol: spawn.patrol, routeId: `patrol:${target.entry}:${target.guid}` } : null;
  const key = target ? `${target.entry}:${target.guid}` : null;
  const missing = target !== null && active === null;
  const needsPath = active !== null && active.patrol === null;
  const pointCount = active?.patrol?.points.length ?? 0;

  // A selected point that an undo or another edit took away is let go, not left pointing at another.
  useEffect(() => {
    setSelected((s) => (s !== null && s >= pointCount ? null : s));
  }, [pointCount]);

  useEffect(() => {
    if (key === null) {
      asked.current = null;
      entered.current = null;
      setSelected(null);
      setPicking(null);
    }
  }, [key]);

  useEffect(() => {
    if (missing) onLeave('That spawn is no longer in the quest.');
  }, [missing, onLeave]);

  useEffect(() => {
    if (!active || entered.current === key) return;
    entered.current = key;
    onEnter(active.spawn);
  }, [active, key, onEnter]);

  useEffect(() => {
    if (!target || !needsPath || !api || asked.current === key) return;
    asked.current = key;
    void api.patrolPathId(target.guid).then((result) => {
      if (!result.ok) {
        onLeave(result.error.message);
        return;
      }
      // A route drawn while the id was on its way is kept, never reset to an empty one.
      if (patrolOf(valuesRef.current, target.entry, target.guid) !== null) return;
      const edit = setPatrol(valuesRef.current, target.entry, target.guid, newPatrol(result.value));
      if (edit) onChange(edit.field, edit.value);
    });
  }, [target, needsPath, api, key, valuesRef, onChange, onLeave]);

  /** Saves a new version of the patrol over whatever the values hold now. */
  function save(next: Patrol): void {
    if (!target) return;
    const edit = setPatrol(valuesRef.current, target.entry, target.guid, next);
    if (edit) onChange(edit.field, edit.value);
  }

  /** The patrol as the values hold it now: edits after an await start from here. */
  const latest = (): Patrol | null => (target ? patrolOf(valuesRef.current, target.entry, target.guid) : null);

  /** The floor nearest `near` under a point, with the other floors there or why there are none. */
  async function zAt(at: { x: number; y: number }, near: number): Promise<{ z: number; candidates: number[]; reason: string | null }> {
    const { result, reason } = await floorsAt(currentMap, at.x, at.y);
    const candidates = result ? floorCandidates(result) : [];
    return { z: chooseZ(candidates, near) ?? near, candidates, reason };
  }

  /** A click on the map while drawing: false when the map should treat it as usual. */
  async function mapClick(at: { x: number; y: number }): Promise<{ handled: boolean; message: string | null }> {
    if (!active || !active.patrol) return { handled: false, message: null };
    if (currentMap !== active.spawn.map) return { handled: true, message: `A patrol stays on ${mapName(active.spawn.map)}.` };
    const before = active.patrol.points.at(-1) ?? active.spawn;
    const { z, candidates, reason } = await zAt(at, before.z);
    const now = latest();
    if (!now) return { handled: true, message: null };
    save(addPoint(now, { x: at.x, y: at.y, z }));
    setSelected(now.points.length);
    onFloors(`${active.routeId}:${now.points.length}`, at, candidates, reason);
    return { handled: true, message: null };
  }

  /** A click on the route's line: a new point there, between the two it joins. */
  async function routeClick(routeId: string, at: { x: number; y: number }): Promise<void> {
    if (!active || !active.patrol || routeId !== active.routeId) return;
    const route = [active.spawn, ...active.patrol.points];
    const segment = nearestSegment(route, at);
    const a = route[segment]!;
    const b = route[(segment + 1) % route.length]!;
    const { z, candidates, reason } = await zAt(at, (a.z + b.z) / 2);
    const now = latest();
    if (!now) return;
    save(insertPoint(now, segment, { x: at.x, y: at.y, z }));
    setSelected(segment);
    onFloors(`${active.routeId}:${segment}`, at, candidates, reason);
  }

  return { active, selected, setSelected, picking, setPicking, save, latest, mapClick, routeClick, zAt };
}
