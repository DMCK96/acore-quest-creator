import { useEffect, useRef, useState } from 'react';
import type { GroupCheck, GroupMove, SpawnGroup } from '@shared/ipc';
import { trapTab } from '../components/trap-tab';
import './ProjectDialog.css';
import './RotationDialog.css';

/** How long after a change the rotation is checked again */
const CHECK_DELAY_MS = 150;

type Kind = 'daily' | 'weekly';
type QuestFacts = { title: string; daily: boolean; weekly: boolean };

/** The server's "already in another rotation" reason: the title it names */
const ALREADY_IN = /^(.+) is already in rotation .+\.$/;
/** Reasons this dialog answers itself for the quests it knows, since it can make them daily or weekly on save */
const NOT_REPEATING = /^(.+) is not a daily or weekly quest\.$/;
const MIXED = 'Daily and weekly quests cannot share a rotation.';

/** A field's number, 0 when it is blank or not a number */
const numberOf = (text: string): number => {
  const n = Number(text);
  return text.trim() === '' || !Number.isFinite(n) ? 0 : n;
};

/** Whether a quest is exactly of this kind: its bit set and the other one clear */
const isKind = (facts: QuestFacts, kind: Kind): boolean => (kind === 'daily' ? facts.daily && !facts.weekly : facts.weekly && !facts.daily);

/** The kind the quests already are: weekly when every known one is, daily when any is; none when none repeats */
function kindOf(ids: readonly number[], titles: ReadonlyMap<number, QuestFacts>): Kind | null {
  const known = ids.flatMap((id) => {
    const facts = titles.get(id);
    return facts ? [facts] : [];
  });
  if (known.some((f) => f.daily)) return 'daily';
  if (known.length > 0 && known.some((f) => f.weekly)) return 'weekly';
  return null;
}

/**
 * Makes or changes a quest rotation (a quest pool): of its daily or weekly quests, so many are offered
 * each reset. Quests are listed by title, can be removed, and other project quests added. A quest not of
 * the chosen kind can be made it on save (its flags change in the same step). The rotation is checked
 * after each change, and the reasons it cannot be saved listed; a quest already in another rotation can
 * be moved here.
 */
export function RotationDialog({
  group,
  titles,
  projectQuests,
  check,
  onSave,
  onDelete,
  onClose,
}: {
  group: SpawnGroup;
  /** Each quest's title, and whether it is daily or weekly now */
  titles: ReadonlyMap<number, QuestFacts>;
  /** The project's quests, which can be added */
  projectQuests: { questId: number; title: string }[];
  check(group: SpawnGroup, moves: GroupMove[]): Promise<GroupCheck>;
  /** `makeKind`: make each of its quests not of that kind into it, in the same step; null to change none */
  onSave(group: SpawnGroup, moves: GroupMove[], makeKind: Kind | null): void;
  onDelete?(): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(group.name);
  const [questIds, setQuestIds] = useState<number[]>(() => group.members.flatMap((m) => (m.type === 'quest' ? [m.questId] : [])));
  const [kind, setKindState] = useState<Kind | null>(() => kindOf(questIds, titles));
  const [offered, setOffered] = useState(String(group.maxActive));
  /** Quests to be made the chosen kind on save */
  const [marked, setMarked] = useState<ReadonlySet<number>>(new Set());
  const [moves, setMoves] = useState<GroupMove[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const titleOf = (id: number): string => titles.get(id)?.title ?? projectQuests.find((q) => q.questId === id)?.title ?? `Quest ${id}`;
  const setKind = (next: Kind): void => {
    setKindState(next);
    // A mark was to make a quest the other kind
    if (next !== kind) setMarked(new Set());
  };

  const edited: SpawnGroup = {
    ...group,
    name: name.trim(),
    maxActive: numberOf(offered),
    members: questIds.map((questId) => ({ type: 'quest' as const, questId })),
  };

  const key = JSON.stringify([edited, moves]);
  const latest = useRef(0);
  useEffect(() => {
    const seq = ++latest.current;
    const checking = key;
    const timer = setTimeout(() => {
      void check(edited, moves).then(
        (found) => {
          if (seq !== latest.current) return;
          setReasons(found.reasons);
          setNotes(found.notes);
          setCheckedKey(checking);
        },
        (error: unknown) => {
          if (seq !== latest.current) return;
          setReasons([error instanceof Error ? error.message : String(error)]);
          setNotes([]);
          setCheckedKey(checking);
        },
      );
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
    // `key` stands for the rotation and the moves
  }, [key]);

  /** The quests, known here, that are not of the chosen kind and are not marked to be made it */
  const needing = kind === null ? [] : questIds.filter((id) => !marked.has(id) && titles.has(id) && !isKind(titles.get(id)!, kind));
  const knownTitles = new Set(questIds.flatMap((id) => (titles.has(id) ? [titles.get(id)!.title] : [])));
  const allKnown = questIds.every((id) => titles.has(id));
  const own: string[] = kind === null ? ['Choose Daily or Weekly.'] : needing.map((id) => `${titleOf(id)} is not a ${kind} quest.`);
  const fromCheck = reasons.filter((reason) => {
    const plain = NOT_REPEATING.exec(reason);
    if (plain && knownTitles.has(plain[1]!)) return false;
    return !(reason === MIXED && allKnown);
  });
  const shown = [...own, ...fromCheck];
  const blocked = shown.length > 0 || checkedKey !== key;
  const makeKind = kind !== null && questIds.some((id) => marked.has(id)) ? kind : null;

  const remove = (id: number): void => {
    setQuestIds((all) => all.filter((q) => q !== id));
    setMoves((all) => all.filter((m) => !(m.kind === 'quest' && m.questId === id)));
  };
  const addable = projectQuests.filter((q) => !questIds.includes(q.questId));
  const add = (id: number): void => {
    setQuestIds((all) => [...all, id]);
    setAdding(false);
  };
  /** The quest a reason names as already in another rotation, when it is one of these and not moved yet */
  const movable = (reason: string): number | null => {
    const found = ALREADY_IN.exec(reason);
    if (!found) return null;
    const id = questIds.find((q) => titleOf(q) === found[1]);
    return id !== undefined && !moves.some((m) => m.kind === 'quest' && m.questId === id) ? id : null;
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal rotation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quest rotation"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (adding) setAdding(false);
            else onClose();
          }
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Quest rotation</h2>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) onSave(edited, moves, makeKind);
          }}
        >
          <p className="rotation-dialog__intro">Of these daily or weekly quests, only some are offered each reset.</p>
          <label className="project-dialog__field">
            <span>Name</span>
            <input type="text" autoFocus placeholder={`Rotation ${group.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="rotation-dialog__kind">
            <legend>Resets</legend>
            {(['daily', 'weekly'] as const).map((k) => (
              <label key={k}>
                <input type="radio" name="rotation-kind" checked={kind === k} onChange={() => setKind(k)} />
                {k === 'daily' ? 'Daily' : 'Weekly'}
              </label>
            ))}
          </fieldset>
          <label className="project-dialog__field">
            <span>Offered each reset</span>
            <input type="number" min={1} max={Math.max(1, questIds.length)} step={1} value={offered} onChange={(e) => setOffered(e.target.value)} />
          </label>
          <h3 className="rotation-dialog__heading">Quests</h3>
          <ul className="rotation-dialog__quests">
            {questIds.map((id) => {
              const title = titleOf(id);
              return (
                <li key={id} aria-label={title}>
                  <span className="rotation-dialog__name">
                    {title} <span className="rotation-dialog__id">#{id}</span>
                  </span>
                  {kind !== null && marked.has(id) && <span className="rotation-dialog__made">{`Made ${kind} on save`}</span>}
                  {kind !== null && needing.includes(id) && (
                    <button type="button" className="btn btn--small" onClick={() => setMarked((all) => new Set([...all, id]))}>
                      {`Make ${title} ${kind}`}
                    </button>
                  )}
                  <button type="button" className="btn btn--small" onClick={() => remove(id)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="rotation-dialog__add">
            <button type="button" className="btn" aria-expanded={adding} disabled={addable.length === 0 && !adding} onClick={() => setAdding((a) => !a)}>
              Add a quest…
            </button>
            {kind !== null && needing.length > 0 && questIds.length > 1 && (
              <button type="button" className="btn" onClick={() => setMarked((all) => new Set([...all, ...needing]))}>
                {`Make them all ${kind}`}
              </button>
            )}
          </div>
          {adding && (
            <ul role="listbox" aria-label="Project quests" className="rotation-dialog__choices">
              {addable.map((q) => (
                <li
                  key={q.questId}
                  role="option"
                  aria-selected={false}
                  tabIndex={0}
                  onClick={() => add(q.questId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      add(q.questId);
                    }
                  }}
                >
                  {`${q.title || '(untitled quest)'} #${q.questId}`}
                </li>
              ))}
            </ul>
          )}
          {shown.length > 0 && (
            <ul className="rotation-dialog__reasons" role="alert">
              {shown.map((reason) => {
                const id = movable(reason);
                return (
                  <li key={reason}>
                    <span>{reason}</span>
                    {id !== null && (
                      <button type="button" className="btn btn--small" onClick={() => setMoves((all) => [...all, { kind: 'quest', questId: id }])}>
                        {`Move ${titleOf(id)} here`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {notes.length > 0 && (
            <ul className="rotation-dialog__notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <div className="rotation-dialog__actions">
            {onDelete && (
              <button type="button" className="btn btn--danger rotation-dialog__delete" onClick={onDelete}>
                Delete rotation
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={blocked}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
