import { Background, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { QuestOrb } from '../components/QuestOrb';
import './IconScreen.css';

/**
 * The app icon's source: the canvas's grid with the quest orb centred on it, and nothing else.
 * The app shows it when opened at `#icon`; `npm run app:icon` captures it as `build/icon.png`.
 */
export function IconScreen(): React.JSX.Element {
  return (
    <div className="icon-screen">
      {/* The same grid the canvas draws, without a canvas to go with it. */}
      <ReactFlowProvider>
        <div className="react-flow icon-screen__grid">
          <Background color="var(--border-soft)" gap={18} />
        </div>
      </ReactFlowProvider>
      <div className="icon-screen__orb">
        <QuestOrb />
      </div>
    </div>
  );
}
