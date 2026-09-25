import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { Api } from '@shared/ipc';

export interface RewardTables {
  xp: (number | null)[];
  money: (number | null)[];
}

const EMPTY_TABLES: RewardTables = { xp: Array(10).fill(null), money: Array(10).fill(null) };

interface RewardTablesStore {
  get(level: number): RewardTables | null;
  request(level: number): void;
  subscribe(listener: () => void): () => void;
}

function createRewardTablesStore(api: Api): RewardTablesStore {
  const cache = new Map<number, RewardTables>();
  const pending = new Set<number>();
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((l) => l());

  return {
    get(level) {
      return cache.get(level) ?? null;
    },
    request(level) {
      if (cache.has(level) || pending.has(level)) return;
      pending.add(level);
      void api.rewardTables(level).then((res) => {
        pending.delete(level);
        cache.set(level, res.ok ? res.value : EMPTY_TABLES);
        notify();
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const RewardTablesContext = createContext<RewardTablesStore | null>(null);

/** Provides `useRewardTables` to its subtree, issuing one `api.rewardTables(level)` per level. */
export function RewardTablesProvider({
  api,
  epoch = 0,
  children,
}: {
  api: Api;
  /** The connection's count: a new connection starts an empty cache. */
  epoch?: number;
  children: ReactNode;
}): React.JSX.Element {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createRewardTablesStore(api), [api, epoch]);
  return <RewardTablesContext.Provider value={store}>{children}</RewardTablesContext.Provider>;
}

/**
 * Reads the cached XP/money reference tables for `level` through the nearest `RewardTablesProvider`,
 * returning `null` until the (batched-by-level, cached) lookup resolves.
 */
export function useRewardTables(level: number): RewardTables | null {
  const store = useContext(RewardTablesContext);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const s = storeRef.current;
    if (!s) return undefined;
    return s.subscribe(forceRender);
  }, [store]);

  useEffect(() => {
    storeRef.current?.request(level);
  }, [store, level]);

  if (!store) return null;
  return store.get(level);
}
