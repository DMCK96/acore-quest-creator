import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, OpenResult, QuestSpawnGroup } from '@shared/ipc';
import type { FieldValue } from '@core/registry/types';
import { EMPTY_ENTITIES, newSpawn } from '@core/entities/model';
import type { Placement } from '@core/world/layer';
import { EntityEditorHost, type EditorState } from '../entities/EntityEditorHost';
import { useHistorySteps } from '../state/history-context';
import { useProjectEntities } from '../state/project-entities';
import { ownViewSpawns } from '@core/entities/view-spawns';
import { toggleRole } from '@core/modules/quest-roles';
import { useApi } from '../state/names';
import { ownEdit } from '../map/own-3d-edit';
import { chainOf, questMenuInfo } from './quest-context';
import { OBJECTIVES_FULL } from './menu/section';
import { WORLD_MAPS, worldMapById } from '@core/map/world-maps';
import type { TeleportSpot } from '@core/map/teleports';
import { World3DView, type FocusTarget } from './World3DView';
import { FindDialog, type FindPreset, type FoundSpawn } from './FindDialog';
import { TeleportDialog } from './TeleportDialog';
import { QuestOrb } from '../components/QuestOrb';
import { readLastPlace, writeLastPlace } from './last-place';
import { markWelcomeSeen, welcomeSeen } from './welcome-seen';
import { Welcome } from './Welcome';
import './world3d.css';

export interface WorldWorkspaceProps {
  /** Whether a game client folder is set: the world is drawn from it */
  hasClient: boolean;
  /** False while the Quests workspace is showing: the world rests until it is shown again. True by default. */
  active?: boolean;
  /** The open project's key (see `projectKey`), for its first-time welcome */
  projectKey: string;
  projectName: string;
  onOpenSettings(): void;
  onShowQuests(): void;
  onStartQuest(): void;
  /** The open quest and the canvas it is on: its own spawns are drawn and edited here, and the menu offers it */
  quest?: { open: OpenResult; nodes: CanvasNode[] };
  /** Changes one of the open quest's fields */
  onQuestField?(fieldId: string, value: FieldValue): void;
  /** Starts a new quest given and taken back by an NPC, after `previous` in its chain when that is set */
  onNewQuest?(giver: { entry: number; name: string }, previous: number | null): void;
  /** A place to take the camera to (Show on the undo note); each request is its own, even to the same place */
  goTo?: { map: number; x: number; y: number; z: number; nonce: number };
}

const ROLE_LABELS: Record<QuestSpawnGroup['spawns'][number]['role'], string> = { giver: 'givers', ender: 'enders', objective: 'objectives', own: 'own' };

/** A quest's spawns as the Find dialog lists them: by quest, then by role */
function presetOf(groups: QuestSpawnGroup[], scope: 'quest' | 'chain'): FindPreset {
  const title = scope === 'chain' ? 'Spawns of the chain' : `Spawns of ${groups[0]?.title ?? 'the quest'}`;
  return {
    title,
    cut: groups.reduce((sum, g) => sum + (g.cut ?? 0), 0),
    groups: groups.flatMap((g) =>
      (['giver', 'ender', 'objective', 'own'] as const).flatMap((role) => {
        const spawns = g.spawns
          .filter((s) => s.role === role)
          .map((s): FoundSpawn => ({ kind: s.kind === 'gameobject' ? 'object' : 'creature', guid: s.guid, entry: s.entry, name: s.name, map: s.map, x: s.x, y: s.y, z: s.z, event: s.event ?? null, note: null }));
        return spawns.length > 0 ? [{ label: `${g.title}: ${ROLE_LABELS[role]}`, spawns }] : [];
      }),
    ),
  };
}

type Point = { x: number; y: number; z: number };

/** How long the welcome takes to fade from the world once something is chosen (matches Welcome.css) */
const WELCOME_FADE_MS = 500;

/**
 * The world, as the app's main workspace: the 3D view of a continent with a place card (where the
 * camera is, Teleport, Find and typed coordinates). It opens where it was left. Without a game client
 * it says what is needed instead. The first time a project is shown here, a welcome over the orb offers
 * a place to start.
 */
export function WorldWorkspace({
  hasClient, active = true, projectKey, projectName, onOpenSettings, onShowQuests, onStartQuest, quest, onQuestField, onNewQuest, goTo: goToRequest,
}: WorldWorkspaceProps): React.JSX.Element {
  // The open quest's values as last changed here, so edits made one after another build on each other
  const values = useRef(quest?.open.aggregate.values);
  values.current = quest?.open.aggregate.values;
  const change = (fieldId: string, value: FieldValue): void => {
    if (values.current) values.current = { ...values.current, [fieldId]: value };
    onQuestField?.(fieldId, value);
  };
  const project = useProjectEntities();
  const store = project?.entities ?? EMPTY_ENTITIES;
  const info = useMemo(() => (quest ? questMenuInfo(quest.open, quest.nodes) : undefined), [quest]);
  const chainIds = useMemo(() => (quest ? chainOf(quest.nodes, quest.open.questId) : undefined), [quest]);
  // The project's NPCs and objects; edits to their spawns go to the whole store
  const storeRef = useRef(store);
  storeRef.current = store;
  // Every project spawn is drawn and edited here, whether or not a quest is open
  const own = useMemo(() => ownViewSpawns(store), [store]);
  const { runStep } = useHistorySteps();
  const api = useApi();
  // The NPC or object editor, opened from the right-click menu
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** New NPC here… / New object here…: one project NPC or object with a spawn where it was asked for, as one step */
  const createEntity = async (what: 'creature' | 'object', at: Placement): Promise<void> => {
    if (!project || !api) return;
    let made: { kind: 'npc' | 'object'; entry: number } | null = null;
    await runStep(async () => {
      const guid = await api.allocateIds(what === 'creature' ? 'creatureSpawn' : 'gameobjectSpawn', 1);
      if (!guid.ok || guid.value.length === 0) {
        setNote(guid.ok ? 'No free spawn ID could be found.' : guid.error.message);
        return;
      }
      const spawn = { ...newSpawn(guid.value[0]!), map: mapRef.current, x: at.x, y: at.y, z: at.z, o: at.orientation, rotation: what === 'object' ? at.rotation : null };
      const kind = what === 'creature' ? 'npc' : 'object';
      const result = await project.create(kind, { spawns: [spawn] });
      if ('error' in result) setNote(result.error);
      else made = { kind, entry: result.entry };
    }, what === 'creature' ? 'New NPC' : 'New object');
    const opened = made as { kind: 'npc' | 'object'; entry: number } | null;
    if (opened) setEditor({ kind: opened.kind, entry: opened.entry, isNew: true, tab: 'basics' });
  };

  /** Make lootable… / Stop being lootable on a project object, asking first when it would stop doing something else */
  const setLootable = async (entry: number, on: boolean): Promise<void> => {
    const object = storeRef.current.objects.find((o) => o.entry === entry);
    if (!project || !object) return;
    const name = object.name.trim() || 'this object';
    if (on && object.pages.length > 0 && !window.confirm(`Make ${name} lootable? Its pages are not shown once it can be looted.`)) return;
    if (on && object.pages.length === 0 && object.onlyDuringQuest !== null && object.type === 'goober'
      && !window.confirm(`Make ${name} lootable? Its quest-only use stops; only its loot can be quest-only.`)) return;
    const next = { ...storeRef.current, objects: storeRef.current.objects.map((o) => (o.entry === entry ? { ...o, type: on ? 'chest' as const : 'goober' as const } : o)) };
    await runStep(async () => {
      storeRef.current = next;
      project.setEntities(next);
    }, on ? `Made ${name} lootable` : `Stopped ${name} being lootable`);
    if (on) setEditor({ kind: 'object', entry, isNew: false, tab: 'contents' });
  };
  // The spawns of the open quest or its chain, listed after the menu showed them
  const [preset, setPreset] = useState<FindPreset | null>(null);
  const [first] = useState(readLastPlace);
  const [mapId, setMapId] = useState(first.map);
  const [at, setAt] = useState<Point>({ x: first.x, y: first.y, z: first.z });
  const mapRef = useRef(mapId);
  mapRef.current = mapId;
  // The coordinates being typed; they only move the camera on Go.
  const [typed, setTyped] = useState({ x: String(first.x), y: String(first.y), z: String(first.z) });
  const [area, setArea] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState(false);
  const [teleporting, setTeleporting] = useState(false);
  const [finding, setFinding] = useState(false);
  // The spawn the view is to bring into view (each pick is its own, even of the same spawn)
  const [focus, setFocus] = useState<FocusTarget | undefined>();
  // Projects whose welcome was closed here; read with what storage says, so a project greeted
  // elsewhere, or opened while this was hidden, is handled when the world is next shown
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const welcoming = active && hasClient && !closed.has(projectKey) && !welcomeSeen(projectKey);
  // The welcome fading out over the world after a choice (the choice itself happens at once)
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => setFading(false), WELCOME_FADE_MS);
    return () => clearTimeout(timer);
  }, [fading]);
  /** Closes the welcome for this project for good, then does what was chosen */
  const leaveWelcome = (then?: () => void): void => {
    markWelcomeSeen(projectKey);
    setClosed((keys) => new Set(keys).add(projectKey));
    setFading(true);
    then?.();
  };

  /** Moves the camera to a point, on the map given (this one by default), and remembers it */
  const goTo = (point: Point, map = mapRef.current): void => {
    if (map !== mapRef.current) setMapId(map);
    setAt(point);
    setTyped({ x: String(point.x), y: String(point.y), z: String(point.z) });
    writeLastPlace({ map, ...point });
  };
  const chooseMap = (id: number): void => goTo(worldMapById(id)!.start, id);
  // Show on the undo note: the camera goes to where the step happened
  useEffect(() => {
    if (!goToRequest || !worldMapById(goToRequest.map)) return;
    goTo({ x: goToRequest.x, y: goToRequest.y, z: goToRequest.z }, goToRequest.map);
    // Only a new request moves the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToRequest?.nonce]);
  const teleport = (spot: TeleportSpot): void => {
    setTeleporting(false);
    goTo({ x: spot.x, y: spot.y, z: spot.z }, spot.map);
  };
  const find = (spawn: FoundSpawn): void => {
    setFinding(false);
    goTo({ x: spawn.x, y: spawn.y, z: spawn.z }, spawn.map);
    setFocus((previous) => ({
      kind: spawn.kind, guid: spawn.guid, entry: spawn.entry, name: spawn.name, x: spawn.x, y: spawn.y, z: spawn.z,
      event: spawn.event, added: spawn.note === 'placed', nonce: (previous?.nonce ?? 0) + 1,
    }));
  };
  const parsed = { x: Number(typed.x), y: Number(typed.y), z: Number(typed.z) };
  const valid = [typed.x, typed.y, typed.z].every((v) => v.trim() !== '') && Object.values(parsed).every(Number.isFinite);

  // Esc closes this workspace's own panels, the top one first; it never leaves the world. The view
  // clears its own selection.
  const panels = useRef({ finding, teleporting, coordinates, welcoming, leaveWelcome, preset });
  panels.current = { finding, teleporting, coordinates, welcoming, leaveWelcome, preset };
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const open = panels.current;
      if (open.preset) setPreset(null);
      else if (open.finding) setFinding(false);
      else if (open.teleporting) setTeleporting(false);
      else if (open.coordinates) setCoordinates(false);
      else if (open.welcoming) open.leaveWelcome();
      else return;
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active]);

  const mapName = worldMapById(mapId)?.name ?? '';

  if (!hasClient) {
    return (
      <section className="world-workspace" aria-label="World">
        <div className="world-empty">
          <div className="world-empty__orb" data-orb-target="">
            <QuestOrb />
          </div>
          <div className="world-empty__card glass">
            <h2 className="world-empty__title">See the world in 3D</h2>
            <p className="world-empty__text">
              The world is drawn from your own game client. Choose its folder in Settings to walk it, place NPCs and objects, and edit their routes.
            </p>
            <div className="world-empty__actions">
              <button type="button" className="btn btn--primary" onClick={onOpenSettings}>
                Open settings
              </button>
              <button type="button" className="btn" onClick={onShowQuests}>
                Go to Quests
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const field = (axis: 'x' | 'y' | 'z'): React.JSX.Element => (
    <label className="scene-field world-place__coordinate">
      <span>{axis.toUpperCase()}</span>
      <input type="number" step="any" value={typed[axis]} onChange={(e) => setTyped((t) => ({ ...t, [axis]: e.target.value }))} />
    </label>
  );

  return (
    <section className="world-workspace" aria-label="World">
      <World3DView
        map={mapId}
        start={at}
        hasClient
        focus={focus}
        active={active}
        showArea={false}
        onArea={setArea}
        onPlaceChange={(place) => writeLastPlace({ map: mapRef.current, ...place })}
        own={own}
        onOwnEdit={
          project
            ? (edit) => {
                const next = ownEdit(storeRef.current, edit);
                if (next) {
                  storeRef.current = next;
                  project?.setEntities(next);
                }
                return next !== null;
              }
            : undefined
        }
        quest={info}
        chainIds={chainIds}
        onQuestRole={(role, target, on) => {
          const edits = values.current ? toggleRole(values.current, role, target, on) : null;
          if (!edits) return OBJECTIVES_FULL;
          for (const [fieldId, value] of Object.entries(edits)) change(fieldId, value);
          return null;
        }}
        onNewQuest={onNewQuest ? (giver, after) => onNewQuest(giver, after && quest ? quest.open.questId : null) : undefined}
        onShowSpawns={(groups, scope) => setPreset(presetOf(groups, scope))}
        onCreateEntity={createEntity}
        onEditEntity={(kind, entry) => setEditor({ kind: kind === 'creature' ? 'npc' : kind, entry, isNew: false })}
        onGoToSpawn={({ map, ...target }) => {
          goTo({ x: target.x, y: target.y, z: target.z }, map);
          setFocus((previous) => ({ ...target, nonce: (previous?.nonce ?? 0) + 1 }));
        }}
        onSetLootable={setLootable}
      />
      {note && (
        <p className="world3d__note" role="status">
          {note}
          <button type="button" className="btn btn--icon" aria-label="Dismiss" onClick={() => setNote(null)}>
            ✕
          </button>
        </p>
      )}
      {editor && project && (
        <div className="modal-backdrop">
          <EntityEditorHost entities={project.entities} onChange={(next) => project.setEntities(next)} quests={project.quests}
            state={editor} onTab={(tab) => setEditor((was) => (was ? { ...was, tab } : was))} onClose={() => setEditor(null)}
            onDelete={(kind, entry) => project.remove(kind, entry)} />
        </div>
      )}
      <section className="world-place glass" aria-label="Place">
        <h2 className="world-place__title">{area ?? mapName}</h2>
        {area && <p className="world-place__map section-label">{mapName}</p>}
        <div className="world-place__actions">
          <button type="button" className="btn" onClick={() => setTeleporting(true)}>
            Teleport
          </button>
          <button type="button" className="btn" onClick={() => setFinding(true)}>
            Find…
          </button>
          <button type="button" className="btn" aria-expanded={coordinates} onClick={() => setCoordinates((open) => !open)}>
            Coordinates
          </button>
        </div>
        {coordinates && (
          <form
            className="world-place__coordinates"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              goTo(parsed);
              setCoordinates(false);
            }}
          >
            <label className="scene-field world-place__map-field">
              <span>Map</span>
              <select value={mapId} onChange={(e) => chooseMap(Number(e.target.value))}>
                {WORLD_MAPS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {field('x')}
            {field('y')}
            {field('z')}
            <button type="submit" className="btn btn--primary" disabled={!valid}>
              Go
            </button>
          </form>
        )}
      </section>
      {(welcoming || (fading && active)) && (
        <Welcome
          projectName={projectName}
          leaving={!welcoming}
          onPick={(spot) => leaveWelcome(() => teleport(spot))}
          onFind={() => leaveWelcome(() => setFinding(true))}
          onStartQuest={() => leaveWelcome(onStartQuest)}
          onClose={() => leaveWelcome()}
        />
      )}
      {finding && <FindDialog from={{ map: mapId, ...at }} onGo={find} onClose={() => setFinding(false)} />}
      {preset && (
        <FindDialog
          from={{ map: mapId, ...at }}
          preset={preset}
          onGo={(spawn) => {
            setPreset(null);
            find(spawn);
          }}
          onClose={() => setPreset(null)}
        />
      )}
      {teleporting && <TeleportDialog onPick={teleport} onClose={() => setTeleporting(false)} />}
    </section>
  );
}
