import { useHistorySteps } from '../state/history-context';
import './ai-lock.css';

/**
 * Keeps what it holds from being edited while an AI client is writing to the project: the content greys
 * out and takes no pointer, keyboard or focus. It lays out as if it were not there.
 */
export function AiLock({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { editLocked } = useHistorySteps();
  return (
    <div className="ai-lock" inert={editLocked || undefined}>
      {children}
    </div>
  );
}

/** A notice that the project is being written to, shown only while it is (and, being brief, a moment later) */
export function AiWritingNotice({ className }: { className?: string }): React.JSX.Element | null {
  const { editLocked } = useHistorySteps();
  if (!editLocked) return null;
  return (
    <p role="status" className={className ? `ai-writing-notice ${className}` : 'ai-writing-notice'}>
      The assistant is changing the project. Editing is paused for a moment.
    </p>
  );
}
