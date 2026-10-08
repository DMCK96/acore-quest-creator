/// <reference types="vite/client" />

import type { Api, ConnectSummary, HistoryList, HistoryResult } from '@shared/ipc';

declare global {
  interface Window {
    /** The preload bridge. Every call answers with a `Result`; none of them reject. */
    readonly api: Api;
    /** Main-process events; absent outside Electron (tests render without a preload). */
    readonly appEvents?: { onFlushRequest(handler: () => Promise<void>): void; onHistory?(handler: (list: HistoryList) => void): void; onExternalChange?(handler: (change: HistoryResult) => void): void; onConnected?(handler: (summary: ConnectSummary) => void): void };
  }
}
