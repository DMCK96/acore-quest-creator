import { useEffect, useRef, useState } from 'react';
import type { GroupCheck, GroupMember, GroupMove, SpawnGroup } from '@shared/ipc';
import { equalShare, memberKey } from '@core/world/groups';
import { trapTab } from '../components/trap-tab';
import '../views/ProjectDialog.css';

/** How long after a change the group is checked again */
const CHECK_DELAY_MS = 150;

/** A percentage to at most 2 decimals, trailing zeros dropped */
const percent = (n: number): string => String(Math.round(n * 100) / 100);

/** A field's number, 0 when it is blank or not a number */
const numberOf = (text: string): number => {
  const n = Number(text);
  return text.trim() === '' || !Number.isFinite(n) ? 0 : n;
};

/** The server's "already in another group" reason: the spawn it names */
const ALREADY_IN = /^Spawn (\d+) is already in group \d+\.$/;

type Row = { member: GroupMember; mode: 'equal' | 'percent'; percent: string };

/** A member's chance; quest members have none */
const chanceOf = (member: GroupMember): number | null => (member.type === 'quest' ? null : member.chance);

const rowOf = (member: GroupMember): Row => {
  const chance = chanceOf(member) ?? 0;
  return { member, mode: chance === 0 ? 'equal' : 'percent', percent: chance === 0 ? '' : String(chance) };
};

/**
 * Makes or changes a spawn group (the server's pool): its name, how many of its members are up at
 * once, and each member's chance (an equal share of what the percentages leave, or a percentage of
 * its own). Other groups on the map can be added as members. The group is checked after each change
 * and the reasons it cannot be saved are listed; a spawn already in another group can be moved here.
 * Notes (a group a move empties, which the save deletes) are listed too but do not block it.
 */
export function GroupDialog({
  group,
  names,
  check,
  groupsOnMap,
  events = [],
  nested = false,
  onSave,
  onRespawnAll,
  onClose,
}: {
  group: SpawnGroup;
  /** Members by name, keyed as `memberKey` keys them */
  names: ReadonlyMap<string, string>;
  check(group: SpawnGroup, moves: GroupMove[]): Promise<GroupCheck>;
  groupsOnMap: { id: number; name: string }[];
  /** The game events a group can follow, by name */
  events?: { id: number; name: string }[];
  /** The group is inside another, so it cannot follow an event itself */
  nested?: boolean;
  onSave(group: SpawnGroup, moves: GroupMove[]): void;
  onRespawnAll?(): void;
  onClose(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(group.name);
  const [upAtOnce, setUpAtOnce] = useState(String(group.maxActive));
  const [rows, setRows] = useState<Row[]>(() => group.members.map(rowOf));
  const [moves, setMoves] = useState<GroupMove[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  /** The group and moves the shown reasons are for; Save waits while it is not the current one */
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [eventMode, setEventMode] = useState<'always' | 'during' | 'except'>(group.event ? (group.event.during ? 'during' : 'except') : 'always');
  const [eventId, setEventId] = useState<number | null>(group.event?.id ?? null);
  const [eventQuery, setEventQuery] = useState<string | null>(null);

  const nameOf = (m: GroupMember): string => {
    const known = names.get(memberKey(m));
    if (known) return known;
    if (m.type === 'group') return groupsOnMap.find((g) => g.id === m.id)?.name || `Group ${m.id}`;
    if (m.type === 'quest') return `Quest ${m.questId}`;
    return `${m.kind === 'object' ? 'Object' : 'NPC'} ${m.guid}`;
  };

  const members: GroupMember[] = rows.map((r) =>
    r.member.type === 'quest' ? r.member : { ...r.member, chance: r.mode === 'equal' ? 0 : numberOf(r.percent) },
  );
  const pickedId = eventId;
  const choosing = !nested && eventMode !== 'always';
  const missingEvent = choosing && pickedId === null;
  const chosenName = events.find((ev) => ev.id === pickedId);
  const needle = (eventQuery ?? '').trim().toLowerCase();
  const matching = events.filter((ev) => !needle || (ev.name || `Event ${ev.id}`).toLowerCase().includes(needle) || String(ev.id).includes(needle));
  const event = nested || eventMode === 'always' || pickedId === null ? null : { id: pickedId, during: eventMode === 'during' };
  const edited: SpawnGroup = { ...group, name: name.trim(), maxActive: numberOf(upAtOnce), members, event };
  const share = equalShare(members);

  // Checked again a moment after each change; an answer to an older group is dropped
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
    // `key` stands for the group and the moves
  }, [key]);

  const setRow = (index: number, change: Partial<Row>): void => setRows((all) => all.map((r, i) => (i === index ? { ...r, ...change } : r)));
  const removeRow = (index: number): void => {
    const gone = rows[index]!.member;
    setRows((all) => all.filter((_, i) => i !== index));
    if (gone.type === 'spawn') setMoves((all) => all.filter((m) => !(m.kind === gone.kind && m.guid === gone.guid)));
  };
  const addable = groupsOnMap.filter((g) => g.id !== group.id && !rows.some((r) => r.member.type === 'group' && r.member.id === g.id));
  const addGroup = (id: number): void => {
    setRows((all) => [...all, rowOf({ type: 'group', id, chance: 0 })]);
    setAdding(false);
  };

  /** The spawn member a reason names as already in another group, when it is one of these */
  const movable = (reason: string): Extract<GroupMember, { type: 'spawn' }> | null => {
    const found = ALREADY_IN.exec(reason);
    if (!found) return null;
    const guid = Number(found[1]);
    const member = members.find((m): m is Extract<GroupMember, { type: 'spawn' }> => m.type === 'spawn' && m.guid === guid);
    return member && !moves.some((m) => m.kind === member.kind && m.guid === guid) ? member : null;
  };

  // A blank name is allowed (the server keeps an empty description); the reasons are what block a save,
  // and a check still waiting or running for the latest change
  const blocked = missingEvent || reasons.length > 0 || checkedKey !== key;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal world3d__group-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Spawn group"
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
          <h2>Spawn group</h2>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) onSave(edited, moves);
          }}
        >
          <p>Only some of a group&rsquo;s members are up at a time; each has a chance to be the one that spawns.</p>
          <label className="scene-field">
            <span>Name</span>
            {/* Esc closes this dialog, not the 3D view round it */}
            <input type="text" autoFocus data-selection="on" placeholder={`Group ${group.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="scene-field">
            <span>Up at once</span>
            <input type="number" min={1} step={1} data-selection="on" value={upAtOnce} onChange={(e) => setUpAtOnce(e.target.value)} />
          </label>
          <label className="scene-field">
            <span>Event</span>
            <select aria-label="Event" data-selection="on" disabled={nested} value={nested ? 'always' : eventMode} onChange={(e) => setEventMode(e.target.value === 'during' ? 'during' : e.target.value === 'except' ? 'except' : 'always')}>
              <option value="always">Always</option>
              <option value="during">Only during</option>
              <option value="except">Except during</option>
            </select>
          </label>
          {!nested && eventMode !== 'always' && (
            <div className="scene-field">
              <label>
                <span>Which event</span>
                <input
                  type="text"
                  role="combobox"
                  aria-label="Which event"
                  aria-expanded="true"
                  aria-controls="group-event-list"
                  data-selection="on"
                  autoComplete="off"
                  placeholder="Search events"
                  value={eventQuery ?? (chosenName ? chosenName.name || `Event ${chosenName.id}` : pickedId !== null ? `Event ${pickedId}` : '')}
                  onChange={(e) => setEventQuery(e.target.value)}
                />
              </label>
              {events.length === 0 ? (
                <p role="alert">No events in the database</p>
              ) : (
                <>
                  {missingEvent && <p role="alert">Choose an event</p>}
                  <ul id="group-event-list" role="listbox" aria-label="Events" className="world3d__group-dialog-events">
                    {matching.map((ev) => (
                      <li
                        key={ev.id}
                        role="option"
                        aria-selected={ev.id === pickedId}
                        onClick={() => {
                          setEventId(ev.id);
                          setEventQuery(null);
                        }}
                      >
                        {ev.name || `Event ${ev.id}`}
                      </li>
                    ))}
                    {matching.length === 0 && <li aria-disabled="true">No event matches</li>}
                  </ul>
                </>
              )}
            </div>
          )}
          {nested && <p>Only a group that is not inside another can follow an event.</p>}
          <h3 className="world3d__group-dialog-heading">Members</h3>
          <ul className="world3d__group-dialog-members">
            {rows.map((row, index) => {
              const label = nameOf(row.member);
              return (
                <li key={memberKey(row.member)} aria-label={label}>
                  <span className="world3d__group-dialog-name">{row.member.type === 'group' ? `${label} (group)` : label}</span>
                  <select
                    aria-label="Chance"
                    data-selection="on"
                    value={row.mode}
                    onChange={(e) => setRow(index, { mode: e.target.value === 'percent' ? 'percent' : 'equal' })}
                  >
                    <option value="equal">Equal share</option>
                    <option value="percent">Percentage</option>
                  </select>
                  {row.mode === 'percent' && (
                    <input
                      type="number"
                      aria-label="Percent"
                      min={0}
                      max={100}
                      step={0.01}
                      data-selection="on"
                      value={row.percent}
                      onChange={(e) => setRow(index, { percent: e.target.value })}
                    />
                  )}
                  <button type="button" className="btn btn--small" onClick={() => removeRow(index)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          {members.some((m) => chanceOf(m) === 0) && (
            <ul className="world3d__group-dialog-shares">
              {members.flatMap((m) => (chanceOf(m) === 0 ? [<li key={memberKey(m)}>{`${nameOf(m)}: ${percent(share)}% (equal share)`}</li>] : []))}
            </ul>
          )}
          <div className="world3d__group-dialog-add">
            <button type="button" className="btn" aria-expanded={adding} disabled={addable.length === 0 && !adding} onClick={() => setAdding((a) => !a)}>
              Add a group…
            </button>
            {adding && (
              <ul role="listbox" aria-label="Groups on this map" className="world3d__group-dialog-choices">
                {addable.map((g) => (
                  <li
                    key={g.id}
                    role="option"
                    aria-selected={false}
                    tabIndex={0}
                    onClick={() => addGroup(g.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        addGroup(g.id);
                      }
                    }}
                  >
                    {g.name || `Group ${g.id}`}
                  </li>
                ))}
              </ul>
            )}
            {onRespawnAll && (
              <button type="button" className="btn" onClick={onRespawnAll}>
                Respawn time…
              </button>
            )}
          </div>
          {reasons.length > 0 && (
            <ul className="world3d__group-dialog-reasons" role="alert">
              {reasons.map((reason) => {
                const member = movable(reason);
                return (
                  <li key={reason}>
                    <span>{reason}</span>
                    {member && (
                      <button type="button" className="btn btn--small" onClick={() => setMoves((all) => [...all, { kind: member.kind, guid: member.guid }])}>
                        {`Move ${nameOf(member)} here`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {notes.length > 0 && (
            <ul className="world3d__group-dialog-notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <div className="world3d__dialog-actions">
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
