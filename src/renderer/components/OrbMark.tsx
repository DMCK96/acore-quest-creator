import './OrbMark.css';

/**
 * The orb, small: the sphere and glow of the big one (its points and threads would not show at this
 * size), pulsing slowly. It marks the app bar and stands for "loading" while it spins. The login
 * screen's orb flies into it when nothing larger is waiting (`data-orb-target`).
 */
export function OrbMark({ size = 28, spinning = false }: { size?: number; spinning?: boolean }): React.JSX.Element {
  return (
    <span
      className={spinning ? 'orb-mark orb-mark--spinning' : 'orb-mark'}
      aria-hidden="true"
      data-orb-target=""
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <span className="orb-mark__glow" />
      <span className="orb-mark__sphere" />
    </span>
  );
}
