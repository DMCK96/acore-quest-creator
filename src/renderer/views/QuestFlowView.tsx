import { useCallback, useEffect, useRef, useState } from 'react';
import { ENTITIES_FIELD, newNpc, newObject, readEntities, writeEntities } from '@core/entities/model';
import { EntityEditorProvider, type EditorRequest, type OpenEditor } from '../entities/EntityEditorContext';
import { EntityEditorHost, type EditorState } from '../entities/EntityEditorHost';
import { MODULES, moduleById, offeredModules, presentModules } from '@core/modules/catalog';
import { routeIssues, worstSeverity } from '@core/modules/issues';
import type { AppStore } from '../state/app-store';
import { useApi, useNameBook } from '../state/names';
import { FidelityBanner } from '../components/FidelityBanner';
import { IssuesList } from '../components/IssuesList';
import { ModuleBox } from '../modules/ModuleBox';
import { ModulePanel, PanelFrame } from '../modules/ModulePanel';
import { ChangesView } from './ChangesView';
import { TestInGameView } from './TestInGameView';
import { QuestMapView } from '../map/QuestMapView';
import { MapOpenerProvider, type MapRequest } from '../map/MapOpener';
import { QuestHeader, type ReadinessChip } from './QuestHeader';
import './QuestFlowView.css';

/**
 * The quest editor: a header, the quest's modules as a flow of boxes (the core four always, then
 * the optional ones it uses), and one module's panel docked beside them.
 */
export function QuestFlowView({ store }: { store: AppStore }): React.JSX.Element | null {
  const open = store((s) => s.open);
  const api = useApi();
  const issues = store((s) => s.issues);
  const links = store((s) => s.links);
  const openPanel = store((s) => s.openPanel);
  const addedModules = store((s) => s.addedModules);
  const setOpenPanel = store((s) => s.setOpenPanel);
  const addModule = store((s) => s.addModule);
  const removeModule = store((s) => s.removeModule);
  const setValue = store((s) => s.setValue);
  const hasServerData = store((s) => Boolean(s.summary?.serverData?.dir));
  const hasClient = store((s) => Boolean(s.summary?.clientDir));
  const backToChain = store((s) => s.backToChain);
  const names = useNameBook();
  const [menuOpen, setMenuOpen] = useState(false);
  /** What the map was opened to do, and the panel to go back to when it closes. */
  const [mapRequest, setMapRequest] = useState<MapRequest | null>(null);
  const [mapReturn, setMapReturn] = useState<typeof openPanel>(null);
  const mapReturnRef = useRef(mapReturn);
  mapReturnRef.current = mapReturn;
  /** The NPC or object editor, open over whichever panel opened it; kept while the map is open. */
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const closeEditor = useCallback(() => setEditor(null), []);
  const onEditorTab = useCallback((tab: string) => setEditor((e) => (e ? { ...e, tab } : e)), []);

  // A map closed any other way than its Close button (Escape, another panel) forgets why it was
  // opened, so the next opening shows the map rather than placing or drawing on the first click.
  useEffect(() => {
    if (openPanel === 'map') return;
    setMapRequest(null);
    setMapReturn(null);
  }, [openPanel]);

  // Escape closes the open panel first, and leaves the editor only when nothing is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const state = store.getState();
      // The map goes back to where it was opened from, like its Close button; the editor sits on top
      // of the panel that opened it, so it closes before that panel.
      // The apply confirmation sits over everything else, so it closes first.
      if (state.pendingApply) state.cancelApply();
      else if (state.openPanel === 'map') state.setOpenPanel(mapReturnRef.current);
      else if (editorRef.current) setEditor(null);
      else if (state.openPanel !== null) state.setOpenPanel(null);
      else void state.backToChain();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);

  if (!open) return null;

  const values = open.aggregate.values;
  const shown = presentModules(values, addedModules);
  const offered = offeredModules(values, addedModules);
  const routed = routeIssues(issues);
  const chips: ReadinessChip[] = shown.flatMap((id) => {
    const severity = worstSeverity(routed.byModule[id]);
    return severity ? [{ id, severity }] : [];
  });
  const core = shown.filter((id) => moduleById(id).kind === 'core');
  const optional = shown.filter((id) => moduleById(id).kind === 'optional');

  const openOwner = async (id: number): Promise<void> => {
    await store.getState().flushSave();
    await store.getState().openQuest(id);
  };

  const box = (id: (typeof shown)[number]): React.JSX.Element => (
    <ModuleBox key={id} def={moduleById(id)} values={values} names={names} severity={worstSeverity(routed.byModule[id])}
      selected={openPanel === id} onOpen={() => setOpenPanel(id)} />
  );

  const openMap = (request: MapRequest | string | null): void => {
    setMapRequest(typeof request === 'string' || request === null ? { kind: 'focus', markerId: request } : request);
    if (openPanel !== 'map') setMapReturn(openPanel === 'changes' || openPanel === 'test' ? null : openPanel);
    setOpenPanel('map');
  };

  const openEditor: OpenEditor = async (request) => {
    if (request.kind === 'npc' || request.kind === 'object') {
      setEditor({ kind: request.kind, entry: request.entry, isNew: false });
      return null;
    }
    if (!api) return 'Not connected.';
    // The first `if` returned for both existing kinds; TypeScript cannot narrow a union-typed `kind` out.
    const made = request as Extract<EditorRequest, { kind: 'newNpc' | 'newObject' }>;
    const isNpc = made.kind === 'newNpc';
    const result = await api.allocateIds(isNpc ? 'creature' : 'gameobject', 1);
    if (!result.ok || result.value.length === 0) return result.ok ? 'No free ID could be found.' : result.error.message;
    const entry = result.value[0]!;
    // Created in the quest at once, from the values as they are now (never a draft).
    const now = readEntities(store.getState().open?.aggregate.values ?? {});
    const next = made.kind === 'newNpc'
      ? { ...now, npcs: [...now.npcs, { ...newNpc(entry), ...made.preset, entry }] }
      : { ...now, objects: [...now.objects, { ...newObject(entry), ...made.preset, entry }] };
    setValue(ENTITIES_FIELD, writeEntities(next));
    made.onCreated?.(entry);
    setEditor({ kind: isNpc ? 'npc' : 'object', entry, isNew: true });
    return null;
  };

  return (
    <EntityEditorProvider open={openEditor}>
    <MapOpenerProvider open={openMap}>
    <div className="quest-flow">
      <div className="quest-flow__main">
        <button type="button" className="btn quest-flow__back" onClick={() => void backToChain()}>
          ← Back to chain
        </button>
        <QuestHeader store={store} chips={chips} />
        <FidelityBanner fidelity={open.fidelity} />
        <ul aria-label="Modules" className="module-flow">
          {core.map(box)}
          {optional.length > 0 && <li className="module-flow__break" aria-hidden="true" />}
          {optional.map(box)}
        </ul>
        {offered.length > 0 && (
          <div className="module-add">
            <button type="button" className="btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              Add module
            </button>
            {menuOpen && (
              <div role="menu" className="module-add__menu">
                {MODULES.filter((m) => offered.includes(m.id)).map((m) => (
                  <button key={m.id} type="button" role="menuitem" className="module-add__item"
                    onClick={() => {
                      setMenuOpen(false);
                      addModule(m.id);
                    }}>
                    <span className="module-add__label">{m.label}</span>
                    <span className="module-add__description">{` — ${m.description}`}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {routed.header.length > 0 && <IssuesList issues={routed.header} />}
      </div>
      {openPanel === 'changes' && (
        <PanelFrame title="Changes" onClose={() => setOpenPanel(null)}>
          <ChangesView store={store} />
        </PanelFrame>
      )}
      {openPanel === 'test' && api && (
        <PanelFrame title="Test in game" onClose={() => setOpenPanel(null)}>
          <TestInGameView api={api} questId={open.questId} />
        </PanelFrame>
      )}
      {openPanel === 'map' && (
        <QuestMapView
          key={JSON.stringify(mapRequest)}
          open={open}
          onChange={setValue}
          focusId={mapRequest?.kind === 'focus' ? mapRequest.markerId : null}
          mode={mapRequest && mapRequest.kind !== 'focus' ? mapRequest : null}
          hasServerData={hasServerData}
          hasClient={hasClient}
          onClose={() => {
            setMapRequest(null);
            setOpenPanel(mapReturn);
            setMapReturn(null);
          }}
        />
      )}
      {openPanel !== null && openPanel !== 'changes' && openPanel !== 'test' && openPanel !== 'map' && (
        <ModulePanel
          key={openPanel}
          id={openPanel}
          issues={routed.byModule[openPanel] ?? []}
          open={open}
          links={links}
          onChange={setValue}
          onOpenQuest={(id) => void openOwner(id)}
          onClose={() => setOpenPanel(null)}
          onRemove={() => removeModule(openPanel)}
        />
      )}
      {editor && openPanel !== 'map' && (
        <EntityEditorHost values={values} onChange={setValue} state={editor} onTab={onEditorTab} onClose={closeEditor} hasServerData={hasServerData} />
      )}
    </div>
    </MapOpenerProvider>
    </EntityEditorProvider>
  );
}
