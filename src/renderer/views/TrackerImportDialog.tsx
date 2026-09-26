import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlannedQuest } from '@core/import/candidate';
import type { CandidateQuery, CandidateRow } from '@shared/candidate';
import type { TrackerImportResult } from '@shared/ipc';
import type { AppStore } from '../state/app-store';
import { useApi } from '../state/names';
import { trapTab } from '../components/trap-tab';
import './ProjectDialog.css';
import './TrackerImportDialog.css';

const PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 250;
/** The most one import takes: the API refuses more in one call. */
const MAX_IMPORT = 50;

const STATUSES: readonly (readonly [string, string])[] = [
  ['Ready', 'Ready'], ['Needs work', 'Needs work'], ['Stub (title only)', 'Stub (title only)'], ['', 'Any'],
];
const WORK_STATES = ['', 'none', 'review', 'queued', 'in_progress', 'done', 'skip'] as const;
const WHERE: Record<'world' | 'project' | 'plan', string> = { world: 'world', project: 'project', plan: 'this import' };

interface Filters {
  q: string;
  status: string;
  tier: string;
  work: string;
  depsOnly: boolean;
}

/** Only the filters that are set, so the tracker is asked for exactly what the user chose. */
function queryOf(f: Filters, page: number): CandidateQuery {
  const query: CandidateQuery = {};
  if (f.q.trim()) query.q = f.q.trim();
  // "Only blocked by missing NPCs, objects or items" is a Needs work filter of its own.
  if (f.status && !f.depsOnly) query.status = f.status;
  if (f.tier !== '') query.tier = Number(f.tier);
  if (f.work) query.work = f.work;
  if (f.depsOnly) query.depsOnly = true;
  query.page = page;
  return query;
}

function summaryOf(result: TrackerImportResult): string {
  const parts: string[] = [];
  if (result.imported.length > 0) parts.push(`Imported ${result.imported.join(', ')}.`);
  if (result.replaced.length > 0) parts.push(`Replaced ${result.replaced.join(', ')}.`);
  for (const s of result.skipped) parts.push(`Skipped ${s.questId} (${s.reason}).`);
  return parts.length > 0 ? parts.join(' ') : 'Nothing was imported.';
}

function replaceQuestion(n: number): string {
  return n === 1
    ? "1 of these quests is already in this project. Replace it with the tracker's data? Your edits to it will be lost."
    : `${n} of these quests are already in this project. Replace them with the tracker's data? Your edits to them will be lost.`;
}

/**
 * Import from the CoA Content Tracker: search its Ascension candidates, preview what one would bring
 * in, and import one or several. The tracker is asked again at import time, so the preview is only
 * ever advice.
 */
export function TrackerImportDialog({ store, onClose }: { store: AppStore; onClose: () => void }): React.JSX.Element {
  const api = useApi();
  const dialog = useRef<HTMLDivElement | null>(null);
  const [filters, setFilters] = useState<Filters>({ q: '', status: 'Ready', tier: '', work: '', depsOnly: false });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [inProject, setInProject] = useState<ReadonlySet<number>>(new Set());
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [preview, setPreview] = useState<PlannedQuest | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TrackerImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const listToken = useRef(0);

  const load = useCallback(async (f: Filters, p: number): Promise<void> => {
    if (!api) return;
    const token = ++listToken.current;
    setLoading(true);
    const r = await api.trackerCandidates(queryOf(f, p));
    if (token !== listToken.current) return;
    setLoading(false);
    if (!r.ok) {
      setListError(r.error.message);
      return;
    }
    setListError(null);
    setRows(r.value.rows);
    setTotal(r.value.total);
    setInProject(new Set(r.value.inProject));
  }, [api]);

  // The first page at once; later filter changes wait for typing to settle.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      void load(filters, page);
      return;
    }
    const timer = setTimeout(() => void load(filters, page), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filters, page, load]);

  // Focus moves in on opening and back to what opened it on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Caught before anything else hears it, so nothing behind the modal closes too.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, busy]);

  const setFilter = (patch: Partial<Filters>): void => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  async function showPreview(key: number): Promise<void> {
    if (!api) return;
    setPreviewError(null);
    const r = await api.trackerPreview([key]);
    if (!r.ok) {
      setPreview(null);
      setPreviewError(r.error.message);
      return;
    }
    setPreview(r.value.quests[0] ?? null);
  }

  async function importQuests(ids: number[]): Promise<void> {
    if (!api || ids.length === 0) return;
    setBusy(true);
    setImportError(null);
    try {
      const planned = await api.trackerPreview(ids);
      if (!planned.ok) {
        setImportError(planned.error.message);
        return;
      }
      const replacing = planned.value.quests.filter((q) => q.action === 'replace').map((q) => q.questId);
      const replace = replacing.length > 0 && window.confirm(replaceQuestion(replacing.length)) ? replacing : [];
      const r = await api.trackerImport({ questIds: ids, replace });
      if (!r.ok) {
        setImportError(r.error.message);
        return;
      }
      await store.getState().loadNodes();
      const brought = [...r.value.imported, ...r.value.replaced];
      if (brought.length === 1 && r.value.skipped.length === 0 && r.value.warnings.length === 0) {
        const opened = await store.getState().openQuest(brought[0]!);
        if (opened) store.getState().editQuest();
        onClose();
        return;
      }
      setResult(r.value);
      setSelected(new Set());
      void load(filters, page);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: number): void =>
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={dialog} tabIndex={-1} className="modal tracker-import" role="dialog" aria-modal="true" aria-labelledby="tracker-import-title"
        onKeyDown={(e) => trapTab(e, dialog.current)}>
        <header className="modal__header">
          <h2 id="tracker-import-title">Import from CoA Content Tracker</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </header>
        <div className="tracker-import__body">
          <section className="tracker-import__list" aria-label="Candidates">
            <div className="tracker-import__filters">
              <input type="search" aria-label="Search title or ID" placeholder="Search title or ID" value={filters.q} onChange={(e) => setFilter({ q: e.target.value })} />
              <label>
                <span>Status</span>
                <select value={filters.status} disabled={filters.depsOnly} onChange={(e) => setFilter({ status: e.target.value })}>
                  {STATUSES.map(([v, text]) => <option key={text} value={v}>{text}</option>)}
                </select>
              </label>
              <label>
                <span>Tier</span>
                <select value={filters.tier} onChange={(e) => setFilter({ tier: e.target.value })}>
                  <option value="">Any</option>
                  {[0, 1, 2, 3, 4].map((t) => <option key={t} value={String(t)}>{t}</option>)}
                </select>
              </label>
              <label>
                <span>Work</span>
                <select value={filters.work} onChange={(e) => setFilter({ work: e.target.value })}>
                  {WORK_STATES.map((w) => <option key={w} value={w}>{w === '' ? 'Any' : w.replace('_', ' ')}</option>)}
                </select>
              </label>
              <label className="tracker-import__check">
                <input type="checkbox" checked={filters.depsOnly} onChange={(e) => setFilter({ depsOnly: e.target.checked })} />
                <span>Only blocked by missing NPCs, objects or items</span>
              </label>
            </div>
            {listError ? (
              <div className="tracker-import__error" role="alert">
                <p>{listError}</p>
                <button type="button" className="btn" onClick={() => void load(filters, page)}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="tracker-import__table-wrap">
                  <table className="tracker-import__table">
                    <thead>
                      <tr>
                        <th aria-label="Select" />
                        <th>ID</th>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Tier</th>
                        <th>Top blocker</th>
                        <th>Giver</th>
                        <th>Ender</th>
                        <th>Work</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} aria-label={`${r.key} ${r.title}`} className={preview?.questId === r.key ? 'tracker-import__row--on' : undefined}>
                          <td>
                            <input type="checkbox" aria-label={`Select quest ${r.key}`} checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
                          </td>
                          <td>{r.key}</td>
                          <td>
                            <button type="button" className="tracker-import__title" onClick={() => void showPreview(r.key)}>
                              {r.title || `Quest ${r.key}`}
                            </button>
                          </td>
                          <td>{r.status}</td>
                          <td>{r.tier_label}</td>
                          <td>{r.top_blocker}</td>
                          <td>{r.giver}</td>
                          <td>{r.ender}</td>
                          <td>{inProject.has(r.key) ? 'In project' : r.work}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!loading && rows.length === 0 && <p className="scene-hint">No candidates match these filters.</p>}
                </div>
                <div className="tracker-import__paging">
                  <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </button>
                  <span>
                    Page {page} of {pages} · {total} candidates
                  </span>
                  <button type="button" className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              </>
            )}
          </section>
          <section className="tracker-import__preview" aria-label="Preview">
            {previewError && <p className="scene-warning" role="alert">{previewError}</p>}
            {!preview && !previewError && <p className="scene-hint">Choose a quest's title to see what importing it brings in.</p>}
            {preview && <Preview plan={preview} />}
          </section>
        </div>
        {result && (
          <div className="tracker-import__result" role="status">
            <p>{summaryOf(result)}</p>
            {result.warnings.length > 0 && (
              <ul>
                {result.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
        {importError && <p className="scene-warning" role="alert">{importError}</p>}
        <footer className="tracker-import__footer">
          {preview && preview.action !== 'skip' && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void importQuests([preview.questId])}>
              Import
            </button>
          )}
          {selected.size > MAX_IMPORT && <span className="scene-hint">Import at most {MAX_IMPORT} quests at a time.</span>}
          {selected.size > 0 && (
            <button type="button" className="btn btn--primary" disabled={busy || selected.size > MAX_IMPORT}
              onClick={() => void importQuests([...selected].sort((a, b) => a - b))}>
              Import {selected.size} selected
            </button>
          )}
          {result && (
            <button type="button" className="btn" onClick={onClose}>
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Preview({ plan }: { plan: PlannedQuest }): React.JSX.Element {
  const named = new Map<string, string>([
    ...plan.references.map((r) => [`${r.kind}:${r.entry}`, r.name] as [string, string]),
    ...plan.creates.npcs.map((n) => [`npc:${n.entry}`, n.name] as [string, string]),
    ...plan.creates.objects.map((o) => [`object:${o.entry}`, o.name] as [string, string]),
  ]);
  const who = (kind: string, entry: number): string => {
    const name = named.get(`${kind}:${entry}`);
    return name ? `${name} (${kind} ${entry})` : `${kind} ${entry}`;
  };
  const objective = plan.values['quest_template.LogDescription'];
  const created = [
    ...plan.creates.npcs.map((n) => ({ key: `npc:${n.entry}`, text: `${n.name} (npc ${n.entry})`, spawns: n.spawns.length })),
    ...plan.creates.objects.map((o) => ({ key: `object:${o.entry}`, text: `${o.name} (object ${o.entry})`, spawns: o.spawns.length })),
    ...plan.creates.items.map((i) => ({ key: `item:${i.entry}`, text: `${i.name} (item ${i.entry})`, spawns: 0 })),
  ];
  return (
    <div className="tracker-import__plan">
      <h3>
        {plan.title || `Quest ${plan.questId}`} <span className="scene-hint">({plan.questId})</span>
      </h3>
      {plan.action === 'skip' && <p className="scene-warning">{plan.reason}</p>}
      {plan.action === 'replace' && <p className="scene-warning">Already in this project: importing it replaces the project's copy.</p>}
      {typeof objective === 'string' && objective.trim() !== '' && <p>{objective}</p>}
      <PlanList title="Given by" lines={plan.givers.map((g) => ({ key: `g${g.kind}${g.entry}`, text: `${who(g.kind, g.entry)} · ${g.how}` }))} empty="Nobody known. Pick a giver after importing." />
      <PlanList title="Handed in to" lines={plan.enders.map((g) => ({ key: `e${g.kind}${g.entry}`, text: `${who(g.kind, g.entry)} · ${g.how}` }))} empty="Nobody known. Pick an ender after importing." />
      <PlanList title="Will be created" lines={created.map((c) => ({ key: c.key, text: c.spawns > 0 ? `${c.text} · ${c.spawns} ${c.spawns === 1 ? 'spawn' : 'spawns'}` : c.text }))} />
      <PlanList title="Already there" lines={plan.references.map((r) => ({ key: `${r.kind}:${r.entry}`, text: `${r.name || `${r.kind} ${r.entry}`} (${r.kind} ${r.entry}) · in the ${WHERE[r.where]}` }))} />
      <PlanList title="Unresolved" tone="error" lines={plan.unresolved.map((u) => ({ key: `${u.kind}:${u.entry}`, text: `${u.kind} ${u.entry}: ${u.reason}` }))} />
      <PlanList title="Not imported" tone="muted" lines={plan.notImported.map((n) => ({ key: n, text: n }))} />
      <PlanList title="The tracker's blockers" lines={plan.evaluation.blockers.map((b) => ({ key: b, text: b }))} />
    </div>
  );
}

function PlanList({ title, lines, empty, tone }: { title: string; lines: { key: string; text: string }[]; empty?: string; tone?: 'error' | 'muted' }): React.JSX.Element | null {
  if (lines.length === 0 && !empty) return null;
  return (
    <div className={`tracker-import__group${tone ? ` tracker-import__group--${tone}` : ''}`}>
      <h4>{title}</h4>
      {lines.length === 0 ? (
        <p className="scene-hint">{empty}</p>
      ) : (
        <ul>
          {lines.map((l) => <li key={l.key}>{l.text}</li>)}
        </ul>
      )}
    </div>
  );
}

