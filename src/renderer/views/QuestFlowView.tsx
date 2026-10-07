import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_ENTITIES } from '@core/entities/model';
import { narrowTo, questUses } from '@core/entities/links';
import { useProjectEntities } from '../state/project-entities';
import { EntityEditorProvider, type EditorRequest, type OpenEditor } from '../entities/EntityEditorContext';
import { EntityEditorHost, type EditorState } from '../entities/EntityEditorHost';
import { MODULES, moduleById, offeredModules, presentModules } from '@core/modules/catalog';
import { routeIssues, worstSeverity } from '@core/modules/issues';
import { rotationLine } from '@core/modules/summaries';
import type { AppStore } from '../state/app-store';
import { useApi, useNameBook } from '../state/names';
import { FidelityBanner } from '../components/FidelityBanner';
import { IssuesList } from '../components/IssuesList';
import { ModuleBox } from '../modules/ModuleBox';
import { ModulePanel, PanelFrame } from '../modules/ModulePanel';
import { ChangesView } from './ChangesView';
import { TestInGameView } from './TestInGameView';
import { QuestHeader, type ReadinessChip } from './QuestHeader';
import './QuestFlowView.css';

/**
 * The quest editor: a header, the quest's modules as a flow of boxes (the core four always, then
 * the optional ones it uses), and one module's panel docked beside them.
 */
export function QuestFlowView({ store }: { store: AppStore }): React.JSX.Element | null {
  const open = store((s) => s.open);
  const api = useApi();
  const project = useProjectEntities();
  const issues = store((s) => s.issues);
  const links = store((s) => s.links);
  const openPanel = store((s) => s.openPanel);
  const addedModules = store((s) => s.addedModules);
  const setOpenPanel = store((s) => s.setOpenPanel);
  const addModule = store((s) => s.addModule);
  const removeModule = store((s) => s.removeModule);
  const setValue = store((s) => s.setValue);
  const hasServerData = store((s) => Boolean(s.summary?.serverData?.dir));
  const backToChain = store((s) => s.backToChain);
  const questPools = store((s) => s.questPools);
  const names = useNameBook();
  const [menuOpen, setMenuOpen] = useState(false);
  /** The NPC or object editor, open over whichever panel opened it. */
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const root = useRef<HTMLDivElement>(null);
  const closeEditor = useCallback(() => setEditor(null), []);
  const onEditorTab = useCallback((tab: string) => setEditor((e) => (e ? { ...e, tab } : e)), []);

  // Escape closes the open panel first, and leaves the editor only when nothing is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Stepped aside for the World, whose Escape it is
      if (e.key !== 'Escape' || root.current?.closest('[hidden]')) return;
      const state = store.getState();
      // The editor sits on top of the panel that opened it, so it closes before that panel. The apply confirmation sits over everything else, so it closes first.
      if (state.pendingApply) state.cancelApply();
      else if (editorRef.current) setEditor(null);
      else if (state.openPanel !== null) state.setOpenPanel(null);
      else void state.backToChain();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);

  if (!open) return null;

  const values = open.aggregate.values;
  // The project's NPCs, objects and items this quest uses: they show its module and sum it up
  const mine = project && open ? narrowTo(project.entities, questUses({ questId: open.questId, aggregate: open.aggregate }, project.entities)) : EMPTY_ENTITIES;
  const tracking = (project?.tracked.length ?? 0) > 0;
  const shown = presentModules(values, addedModules, tracking);
  const offered = offeredModules(values, addedModules, tracking);
  const routed = routeIssues(issues);
  const inRotation = rotationLine(open.questId, questPools);
  const rotation = inRotation ? [inRotation] : [];
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
    <ModuleBox key={id} def={moduleById(id)} values={values} names={names} entities={mine} severity={worstSeverity(routed.byModule[id])}
      selected={openPanel === id} extra={id === 'behaviour' ? rotation : []} onOpen={() => setOpenPanel(id)} />
  );

  const openEditor: OpenEditor = async (request) => {
    if (request.kind === 'npc' || request.kind === 'object' || request.kind === 'item') {
      // An existing one is brought into the project first
      const error = project ? await project.ensure({ kind: request.kind, entry: request.entry }) : null;
      if (error) return error;
      setEditor({ kind: request.kind, entry: request.entry, isNew: false });
      return null;
    }
    if (!api) return 'Not connected.';
    // The first `if` returned for both existing kinds; TypeScript cannot narrow a union-typed `kind` out.
    const made = request as Extract<EditorRequest, { kind: 'newNpc' | 'newObject' | 'newItem' }>;
    // Created in the project at once (never a draft); a quest uses it once it names it (`onCreated`)
    const kind = made.kind === 'newNpc' ? 'npc' : made.kind === 'newObject' ? 'object' : 'item';
    const result = await store.getState().createEntity(kind, made.preset ?? {});
    if ('error' in result) return result.error;
    const entry = result.entry;
    made.onCreated?.(entry);
    setEditor({ kind: made.kind === 'newNpc' ? 'npc' : made.kind === 'newObject' ? 'object' : 'item', entry, isNew: true });
    return null;
  };

  return (
    <EntityEditorProvider open={openEditor}>
    <div ref={root} className="quest-flow">
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
      {openPanel !== null && openPanel !== 'changes' && openPanel !== 'test' && (
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
      {editor && (
        <EntityEditorHost entities={project?.entities ?? EMPTY_ENTITIES} onChange={(next) => project?.setEntities(next)} quests={project?.quests ?? []} layer={project?.layer}
          state={editor} onTab={onEditorTab} onClose={closeEditor} hasServerData={hasServerData}
          onDelete={(kind, entry) => store.getState().deleteEntity(kind, entry)} />
      )}
    </div>
    </EntityEditorProvider>
  );
}
