import { useEffect, useRef, useState } from 'react';
import type { Api, NpcQuest } from '@shared/ipc';
import { trapTab } from '../components/trap-tab';
import '../views/ProjectDialog.css';

type Found = { starts: NpcQuest[]; ends: NpcQuest[] };

/** One of the two lists: the quests, each a button that opens it */
function QuestList({ heading, quests, onOpen }: { heading: string; quests: NpcQuest[]; onOpen(id: number): void }): React.JSX.Element {
  return (
    <section>
      <h3>{heading}</h3>
      {quests.length === 0 ? (
        <p>None</p>
      ) : (
        <ul>
          {quests.map((q) => (
            <li key={q.id}>
              <button type="button" className="btn" onClick={() => onOpen(q.id)}>
                {q.title || 'Untitled'} <small>#{q.id}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The quests an NPC starts and ends in the database; choosing one opens it in the quest editor */
export function NpcQuestsDialog({ api, entry, name, onOpen, onClose }: { api: Api; entry: number; name: string; onOpen(id: number): void; onClose(): void }): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<Found | string | null>(null);

  useEffect(() => {
    let current = true;
    void api.questsOfNpc(entry).then((result) => {
      if (current) setFound(result.ok ? result.value : result.error.message);
    });
    return () => {
      current = false;
    };
  }, [api, entry]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Quests of ${name}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2>Quests of {name}</h2>
          <button type="button" className="btn btn--icon" aria-label="Close" autoFocus onClick={onClose}>
            ✕
          </button>
        </header>
        {found === null && <p>Looking…</p>}
        {typeof found === 'string' && <p role="alert">{found}</p>}
        {found !== null && typeof found !== 'string' && (
          <>
            <QuestList heading="Starts" quests={found.starts} onOpen={onOpen} />
            <QuestList heading="Ends" quests={found.ends} onOpen={onOpen} />
          </>
        )}
      </div>
    </div>
  );
}
