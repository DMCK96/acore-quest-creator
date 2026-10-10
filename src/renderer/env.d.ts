/// <reference types="vite/client" />

import type { Api, ConnectSummary, HistoryList, HistoryResult, RendererRequest } from '@shared/ipc';

declare global {
  interface Window {
    /** The preload bridge. Every call answers with a `Result`; none of them reject. */
    readonly api: Api;
    /** Main-process events; absent outside Electron (tests render without a preload). */
    readonly appEvents?: { onFlushRequest(handler: () => Promise<void>): void; onHistory?(handler: (list: HistoryList) => void): void; onHoldEdits?(handler: (held: boolean) => void): void; onExternalChange?(handler: (change: HistoryResult) => void): void; onConnected?(handler: (summary: ConnectSummary) => void): void; onDebugChanged?(handler: (enabled: boolean) => void): void; onDebugRequest?(handler: (request: RendererRequest) => void): void };
  }
}
