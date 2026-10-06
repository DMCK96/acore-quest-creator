import { QuestOrb } from '../../components/QuestOrb';
import { AnimatedButton } from '../../components/AnimatedButton';

/** What the chain dock shows over an empty graph: the two ways to start, round the quest orb. */
export function ChainEmpty({ onNewQuest, onAddExisting }: { onNewQuest(): void; onAddExisting(): void }): React.JSX.Element {
  return (
    <div className="canvas-empty">
      <div className="canvas-empty__circle" data-orb-target="">
        <QuestOrb />
        <div className="canvas-empty__content">
          <svg className="canvas-empty__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 3.5h10.5a2 2 0 0 1 2 2V17" />
            <path d="M7 3.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V17H9v1.5a2 2 0 0 1-2 2" />
            <path d="M9 8h7M9 11.5h7" />
          </svg>
          <h2 className="canvas-empty__title">Quests</h2>
          <p className="canvas-empty__subtitle">
            No quests in this project yet. Write one from scratch, or bring in an existing chain from the world database to rework it.
          </p>
          <div className="canvas-empty__actions">
            <AnimatedButton className="canvas-empty__btn" onClick={onNewQuest}>
              <svg className="canvas-empty__btn-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2v12M2 8h12" />
              </svg>
              Create New Quest
            </AnimatedButton>
            <AnimatedButton className="canvas-empty__btn" onClick={onAddExisting}>
              <svg className="canvas-empty__btn-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
                <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
              </svg>
              Add Existing Quest Chain
            </AnimatedButton>
          </div>
        </div>
      </div>
    </div>
  );
}
