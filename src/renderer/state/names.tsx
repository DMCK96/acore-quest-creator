import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { RefKind } from '@core/db/types';
import type { Api } from '@shared/ipc';

export type NameStatus = 'idle' | 'loading' | 'found' | 'missing' | 'unsupported';

export interface NameResult {
  state: NameStatus;
  name?: string;
}

/** The `RefKind`s the world DB can actually resolve a display name for. */
const SUPPORTED_KINDS: readonly RefKind[] = ['item', 'creature', 'gameobject', 'quest'];

function isSupported(kind: RefKind): boolean {
  return SUPPORTED_KINDS.includes(kind);
}

/** Schedules `run` for the next animation frame, falling back to a macrotask outside a browser. */
const scheduleFrame: (run: () => void) => void =
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (run) => setTimeout(run, 0);

interface NamesStore {
  get(kind: RefKind, id: number): NameResult;
  request(kind: RefKind, id: number): void;
  subscribe(listener: () => void): () => void;
}

function createNamesStore(api: Api): NamesStore {
  const cache = new Map<string, NameResult>();
  const pending = new Map<RefKind, Set<number>>();
  const listeners = new Set<() => void>();
  let scheduled = false;

  const key = (kind: RefKind, id: number): string => `${kind}:${id}`;
  const notify = (): void => listeners.forEach((l) => l());

  function flush(): void {
    scheduled = false;
    const batches = new Map(pending);
    pending.clear();
    for (const [kind, ids] of batches) {
      const idList = [...ids];
      void api.lookupNames(kind, idList).then((res) => {
        for (const id of idList) {
          if (res.ok && Object.prototype.hasOwnProperty.call(res.value, id)) {
            cache.set(key(kind, id), { state: 'found', name: res.value[id] });
          } else {
            cache.set(key(kind, id), { state: 'missing' });
          }
        }
        notify();
      });
    }
  }

  return {
    get(kind, id) {
      if (id === 0) return { state: 'idle' };
      if (!isSupported(kind)) return { state: 'unsupported' };
      return cache.get(key(kind, id)) ?? { state: 'idle' };
    },
    request(kind, id) {
      if (id === 0 || !isSupported(kind)) return;
      const k = key(kind, id);
      if (cache.has(k)) return;
      cache.set(k, { state: 'loading' });
      let set = pending.get(kind);
      if (!set) {
        set = new Set();
        pending.set(kind, set);
      }
      set.add(id);
      if (!scheduled) {
        scheduled = true;
        scheduleFrame(flush);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const NamesContext = createContext<NamesStore | null>(null);

/** Provides `useName` to its subtree, batching id lookups per animation frame per `RefKind`. */
export function NamesProvider({ api, children }: { api: Api; children: ReactNode }): React.JSX.Element {
  const store = useMemo(() => createNamesStore(api), [api]);
  return <NamesContext.Provider value={store}>{children}</NamesContext.Provider>;
}

/**
 * Resolves the display name for `(kind, id)` through the nearest `NamesProvider`.
 *
 * `id = 0` is always `idle` (nothing to look up). A kind outside item/creature/gameobject/quest is
 * always `unsupported`. Otherwise this triggers a batched lookup and re-renders once it resolves.
 */
export function useName(kind: RefKind, id: number): NameResult {
  const store = useContext(NamesContext);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const s = storeRef.current;
    if (!s) return undefined;
    return s.subscribe(forceRender);
  }, [store]);

  useEffect(() => {
    storeRef.current?.request(kind, id);
  }, [store, kind, id]);

  if (!store) return { state: 'idle' };
  return store.get(kind, id);
}
