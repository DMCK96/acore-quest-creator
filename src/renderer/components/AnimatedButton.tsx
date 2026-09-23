import { motion } from 'motion/react';
import type { ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragStart' | 'onDragEnd'>;

/**
 * The `.btn`/`.btn--primary` look with a Motion hover/tap spring: the shared element-animation
 * entry point for buttons going forward, so each call site doesn't hand-roll its own transition.
 */
export function AnimatedButton({ className = '', ...props }: Props): React.JSX.Element {
  return (
    <motion.button
      type="button"
      className={`btn ${className}`.trim()}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      {...props}
    />
  );
}
