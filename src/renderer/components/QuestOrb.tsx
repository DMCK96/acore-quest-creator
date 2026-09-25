import { useEffect, useRef } from 'react';
import './QuestOrb.css';

// The halo canvas extends past the sphere by this fraction of the sphere's diameter on every side
// (must match the negative inset in QuestOrb.css).
const HALO_OVERHANG = 0.45;

const PARTICLE_COUNT = 60;
// Particles live in a ring from just inside the rim out to RING_OUTER sphere radii.
const RING_INNER = 0.92;
const RING_OUTER = 1.35;
// Two particles closer than this (in sphere radii) are joined by a line.
const LINK_DISTANCE = 0.32;
const COLOR = '255, 246, 228';

interface Particle {
  angle: number;
  radius: number; // in sphere radii
  spin: number; // rad/s; sign alternates per layer so the two layers shear past each other
  wobblePhase: number;
  wobbleSpeed: number;
  size: number;
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    // Bias toward the rim so the halo is densest at the edge and thins outward.
    const t = Math.random() ** 1.8;
    const outer = i % 3 === 0;
    return {
      angle: Math.random() * Math.PI * 2,
      radius: RING_INNER + t * (RING_OUTER - RING_INNER),
      spin: (outer ? -0.035 : 0.06) * (0.8 + Math.random() * 0.4),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.3 + Math.random() * 0.5,
      size: 0.4 + Math.random() * 1.1,
    };
  });
}

// Fades a particle from full strength at the rim to nothing at the ring's outer edge.
function fade(radius: number): number {
  const f = 1 - (radius - 1) / (RING_OUTER - 1);
  return Math.max(0, Math.min(1, f));
}

// jsdom (tests) has no 2D canvas; Chromium/Electron does. Without it the sphere still renders.
const canvasSupported = typeof OffscreenCanvas !== 'undefined';

/** The glowing sphere behind the canvas empty-state ("Start Your Journey"), ringed by a slowly
 * rotating constellation of fine points and threads that trail off its edge. */
export function QuestOrb({ detail = 1 }: {
  /** Scales the points and threads, for an image shown much smaller than it is drawn (the app icon). */
  detail?: number;
} = {}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const particles = makeParticles();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let frame = 0;
    let last = performance.now();
    let elapsed = 0;

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };

    const draw = (): void => {
      const { width, height } = canvas;
      const cx = width / 2;
      const cy = height / 2;
      const sphereRadius = width / (2 * (1 + 2 * HALO_OVERHANG));
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, width, height);

      const pts = particles.map((p) => {
        const r = p.radius + Math.sin(elapsed * p.wobbleSpeed + p.wobblePhase) * 0.025;
        const a = p.angle + elapsed * p.spin;
        return { x: cx + Math.cos(a) * r * sphereRadius, y: cy + Math.sin(a) * r * sphereRadius, alpha: fade(r), p };
      });

      const linkPx = LINK_DISTANCE * sphereRadius;
      ctx.lineWidth = 0.5 * detail * dpr;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        if (a.alpha <= 0) continue;
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > linkPx) continue;
          const alpha = (1 - d / linkPx) * Math.min(a.alpha, b.alpha) * 0.55;
          if (alpha < 0.01) continue;
          ctx.strokeStyle = `rgba(${COLOR}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const { x, y, alpha, p } of pts) {
        if (alpha <= 0) continue;
        ctx.fillStyle = `rgba(${COLOR}, ${Math.min(1, alpha * 1.1)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * detail * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (now: number): void => {
      elapsed += Math.min(now - last, 100) / 1000; // clamp so a backgrounded tab doesn't jump
      last = now;
      draw();
      frame = requestAnimationFrame(tick);
    };

    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { resize(); draw(); }) : undefined;
    observer?.observe(canvas);
    if (reducedMotion) draw();
    else frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [detail]);

  return (
    <div className="quest-orb" aria-hidden="true">
      {canvasSupported && <canvas ref={canvasRef} className="quest-orb-halo" />}
      <div className="quest-orb-glow" />
      <div className="quest-orb-sphere" />
    </div>
  );
}
