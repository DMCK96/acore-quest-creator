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

function StartRow({ instance }: { instance: LinkView }): React.JSX.Element {
  const claim = instance.claims[0];
  return (
    <li>
      <span>{instance.summary}</span>
      {!instance.editable && instance.readOnlyReason && (
        <span className="quest-starts__reason"> {instance.readOnlyReason}</span>
      )}
      {instance.inactiveReason && <span className="quest-starts__inactive"> {instance.inactiveReason}</span>}
      {instance.editable && claim && (
        <button type="button" aria-label={`Edit: ${instance.summary}`} onClick={() => jumpToField(claim)}>
          Edit
        </button>
      )}
    </li>
  );
}

/**
 * The Availability tab's answer to "how does a player get this quest": every recognised start or
 * unlock, in plain language, plus the script rows the tool could not parse and the components this
 * database cannot support at all, so nothing about a quest's availability is left unexplained.
 */
export function QuestStartsList({ links }: { links: QuestLinks | null }): React.JSX.Element | null {
  if (links === null) return null;

  return (
    <section aria-label="Quest starts" className="quest-starts">
      <h3>How this quest starts</h3>
      {links.instances.length === 0 ? (
        <p>Nothing starts or unlocks this quest yet.</p>
      ) : (
        <ul>
          {links.instances.map((instance) => (
            <StartRow key={instance.id} instance={instance} />
          ))}
        </ul>
      )}
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
