import { useEffect, useRef, useState } from 'react';

/**
 * Local editing state for a control whose value is only pushed upstream when it parses/validates.
 *
 * A purely controlled `<input value={value}>` would snap back to the last value the parent
 * accepted after every keystroke that the parent does not (or cannot, synchronously) echo back,
 * which makes it impossible to type a negative sign or an in-progress decimal. Instead each
 * control owns its own text and only re-syncs from the prop when the parent's value changes to
 * something this control did not just report itself.
 */
export function useLocalText<V>(value: V, serialize: (v: V) => string) {
  const [text, setText] = useState(() => serialize(value));
  const lastKnown = useRef(value);

  useEffect(() => {
    if (!Object.is(value, lastKnown.current)) {
      lastKnown.current = value;
      setText(serialize(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next: V): void {
    lastKnown.current = next;
  }

  return { text, setText, commit };
}
