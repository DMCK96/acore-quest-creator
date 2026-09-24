import type { Page } from '@core/entities/model';
import { TextField } from '../../scripts/fields';

/** The text a readable or usable object shows, one page after another. */
export function PageList({ pages, onChange, allocate }: { pages: readonly Page[]; onChange(next: Page[]): void; allocate(): Promise<number | null> }): React.JSX.Element {
  const set = (i: number, page: Page): void => onChange(pages.map((p, j) => (j === i ? page : p)));
  const move = (i: number, by: -1 | 1): void => {
    const next = [...pages];
    const [taken] = next.splice(i, 1);
    next.splice(i + by, 0, taken!);
    onChange(next);
  };
  async function add(): Promise<void> {
    const id = await allocate();
    if (id !== null) onChange([...pages, { id, text: '' }]);
  }
  return (
    <div className="scene-section">
      <h4 className="scene-section__title">Pages</h4>
      {pages.length === 0 && <p className="scene-hint">No pages yet. Using the object shows the first page.</p>}
      <ol className="scene-steps">
        {pages.map((page, i) => (
          <li key={page.id} className="scene-step">
            <div className="scene-step__head">
              <strong>Page {i + 1}</strong>
              <span className="entry-card__actions">
                <button type="button" className="entry-card__btn" disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </button>
                <button type="button" className="entry-card__btn" disabled={i === pages.length - 1} onClick={() => move(i, 1)}>
                  Down
                </button>
                <button type="button" className="entry-card__btn entry-card__btn--danger" onClick={() => onChange(pages.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </span>
            </div>
            <TextField label={`Page ${i + 1}`} long value={page.text} onChange={(text) => set(i, { ...page, text })} />
          </li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => void add()}>
        Add page
      </button>
    </div>
  );
}
