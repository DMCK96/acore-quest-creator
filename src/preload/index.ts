import { contextBridge, ipcRenderer } from 'electron';
// Not `../shared/ipc`: a sandboxed preload cannot `require` zod out of node_modules.
import { API_METHODS, channelFor, CONNECTED_CHANNEL, EXTERNAL_CHANGE_CHANNEL, FLUSH_DONE_CHANNEL, FLUSH_REQUEST_CHANNEL, HISTORY_CHANNEL } from '../shared/api-methods';

/**
 * The only thing the renderer can reach: one function per API method, each forwarding to the
 * matching IPC channel. There is no other bridge, so the renderer cannot touch Node, MySQL or the
 * file system even if a dependency tries to.
 */
const api = Object.fromEntries(
  API_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(channelFor(method), ...args)]),
);

contextBridge.exposeInMainWorld('api', api);

/** Lets the renderer hand over pending edits when main is about to close the window. */
contextBridge.exposeInMainWorld('appEvents', {
  /** The undo history, sent after every step, undo, redo, save and clear. */
  onHistory(handler: (list: unknown) => void): void {
    ipcRenderer.on(HISTORY_CHANNEL, (_event, list: unknown) => handler(list));
  },
  /** The main process connected to a world database on its own (Claude, through MCP). */
  onConnected(handler: (summary: unknown) => void): void {
    ipcRenderer.on(CONNECTED_CHANNEL, (_event, summary: unknown) => handler(summary));
  },
  /** A change the main process made on its own (Claude, through MCP), shaped like an undo result. */
  onExternalChange(handler: (change: unknown) => void): void {
    ipcRenderer.on(EXTERNAL_CHANGE_CHANNEL, (_event, change: unknown) => handler(change));
  },
  onFlushRequest(handler: () => Promise<void>): void {
    ipcRenderer.on(FLUSH_REQUEST_CHANNEL, () => {
      void (async () => {
        try {
          await handler();
        } finally {
          ipcRenderer.send(FLUSH_DONE_CHANNEL);
        }
      })();
    });
  },
});
