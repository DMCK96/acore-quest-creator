import type { LinkView, QuestLinks } from '@shared/ipc';
import type { RowRef } from '@core/links/model';
import './QuestStartsList.css';

/**
 * The field an editable start's first claim leads to. A rowset claim (e.g. `creature_queststarter`)
 * has no `column`, and its control renders as a `<fieldset>` with no `id` of its own, so `data-field`
 * on GroupPanel's field wrapper is the only handle either shape of claim can be found by.
 */
function fieldIdOf(claim: RowRef): string {
  return claim.column ? `${claim.table}.${claim.column}` : claim.table;
}

/** Scrolls to and focuses the control behind an editable start, so "Edit" actually lands somewhere. */
function jumpToField(claim: RowRef): void {
  const wrapper = document.querySelector(`[data-field="${fieldIdOf(claim)}"]`);
  if (!wrapper) return;
  wrapper.scrollIntoView?.();
  const control = wrapper.querySelector<HTMLElement>('input, select, textarea, button');
  control?.focus();
}

interface RowProps {
  instance: LinkView;
  questId: number;
  onOpenQuest: (questId: number) => void;
}

/**
 * A link is edited on the quest that owns its rows: "turning in A unlocks B" is B's `PrevQuestID`,
 * so on A's tab the only honest action is to open B. "Edit" jumps to a field of the open quest, and
 * offering it for a row another quest owns would land on this quest's own, unrelated, field.
 */
function StartRow({ instance, questId, onOpenQuest }: RowProps): React.JSX.Element {
  const claim = instance.claims[0];
  const owned = instance.owner === questId;
  return (
    <li>
      <span>{instance.summary}</span>
      {!instance.editable && instance.readOnlyReason && (
        <span className="quest-starts__reason"> {instance.readOnlyReason}</span>
      )}
      {instance.inactiveReason && <span className="quest-starts__inactive"> {instance.inactiveReason}</span>}
      {owned && instance.editable && claim && (
        <button type="button" aria-label={`Edit: ${instance.summary}`} onClick={() => jumpToField(claim)}>
          Edit
        </button>
      )}
      {!owned && (
        <button type="button" onClick={() => onOpenQuest(instance.owner)}>
          Open quest {instance.owner}
        </button>
      )}
    </li>
  );
}

const isQuest = (endpoint: LinkView['from'], questId: number): boolean =>
  endpoint.kind === 'quest' && endpoint.questId === questId;

/** Starts and unlocks *of* this quest, including every group it belongs to. */
function startsThis(instance: LinkView, questId: number): boolean {
  if (isQuest(instance.to, questId)) return true;
  const members = instance.params.members;
  return instance.from.kind === 'group' && Array.isArray(members) && members.includes(questId);
}

/** Quest links from this quest on to another one. */
function unlockedByThis(instance: LinkView, questId: number): boolean {
  return isQuest(instance.from, questId) && instance.to.kind === 'quest' && instance.to.questId !== questId;
}

function LinkSection(props: {
  title: string;
  empty: string;
  instances: LinkView[];
  questId: number;
  onOpenQuest: (questId: number) => void;
}): React.JSX.Element {
  const { title, empty, instances, questId, onOpenQuest } = props;
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {instances.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {instances.map((instance) => (
            <StartRow key={instance.id} instance={instance} questId={questId} onOpenQuest={onOpenQuest} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Availability tab's answer to "how does a player get this quest", and what finishing it leads
 * to: every recognised start or unlock in plain language, plus the script rows the tool could not
 * parse and the components this database cannot support at all, so nothing about a quest's
 * availability is left unexplained.
 */
export function QuestStartsList({
  links,
  questId,
  onOpenQuest,
}: {
  links: QuestLinks | null;
  questId: number;
  onOpenQuest: (questId: number) => void;
}): React.JSX.Element | null {
  if (links === null) return null;
  const starts = links.instances.filter((instance) => startsThis(instance, questId));
  const unlocks = links.instances.filter((instance) => !startsThis(instance, questId) && unlockedByThis(instance, questId));

  return (
    <section aria-label="Quest starts" className="quest-starts">
      <LinkSection
        title="How this quest starts"
        empty="Nothing starts this quest yet."
        instances={starts}
        questId={questId}
        onOpenQuest={onOpenQuest}
      />
      <LinkSection
        title="What this quest unlocks"
        empty="This quest does not unlock another quest."
        instances={unlocks}
        questId={questId}
        onOpenQuest={onOpenQuest}
      />
      {links.unrecognised.length > 0 && (
        <>
          <h4>Script rows the tool does not understand yet</h4>
          <ul>
            {links.unrecognised.map((row, i) => (
              <li key={`${row.questId}-${row.key}-${i}`}>{row.summary}</li>
            ))}
          </ul>
        </>
      )}
      {links.unavailable.length > 0 && (
        <>
          <h4>Not available on this database</h4>
          <ul>
            {links.unavailable.map((u) => (
              <li key={u.component}>
                {u.label}: {u.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
