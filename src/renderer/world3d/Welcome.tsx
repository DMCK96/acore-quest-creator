import { useRef } from 'react';
import type { TeleportSpot } from '@core/map/teleports';
import spots from '@core/map/teleports.json';
import { QuestOrb } from '../components/QuestOrb';
import { trapTab } from '../components/trap-tab';
import { TeleportPicker } from './TeleportPicker';
import { quickPicks } from './teleport-picks';
import './Welcome.css';

const PICKS = quickPicks(spots as TeleportSpot[]);

/**
 * The first look at a project in the world: the orb glowing behind a card that offers a place to
 * start (a well-known one, or any found by name), finding an NPC or object, starting a quest, or just
 * looking around.
 */
export function Welcome({ projectName, onPick, onFind, onStartQuest, onClose }: {
  projectName: string;
  onPick(spot: TeleportSpot): void;
  onFind(): void;
  onStartQuest(): void;
  onClose(): void;
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null);
  const name = projectName.trim();
  return (
    <div className="welcome" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="welcome__orb" data-orb-target="">
        <QuestOrb />
      </div>
      <div ref={card} className="welcome__card glass" role="dialog" aria-modal="true" aria-label="Welcome" onKeyDown={(e) => trapTab(e, card.current)}>
        <h2 className="welcome__title">{name ? `Welcome to ${name}` : 'Welcome'}</h2>
        <p className="welcome__lead">Walk the world, place and move NPCs and objects, and build the quests around them.</p>
        <p className="section-label welcome__label">Where to start</p>
        <ul className="welcome__picks" aria-label="Well-known places">
          {PICKS.map((spot) => (
            <li key={spot.name}>
              <button type="button" className="btn welcome__pick" onClick={() => onPick(spot)}>
                {spot.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="welcome__search teleport">
          <TeleportPicker onPick={onPick} autoFocus />
        </div>
        <div className="welcome__actions">
          <button type="button" className="btn" onClick={onFind}>
            Find an NPC or object
          </button>
          <button type="button" className="btn" onClick={onStartQuest}>
            Start a quest
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Just look around
          </button>
        </div>
      </div>
    </div>
  );
}
