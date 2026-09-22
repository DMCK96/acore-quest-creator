import { contextBridge, ipcRenderer } from 'electron';
// Not `../shared/ipc`: a sandboxed preload cannot `require` zod out of node_modules.
import { API_METHODS, channelFor } from '../shared/api-methods';

/**
 * The only thing the renderer can reach: one function per API method, each forwarding to the
 * matching IPC channel. There is no other bridge, so the renderer cannot touch Node, MySQL or the
 * file system even if a dependency tries to.
 */
const api = Object.fromEntries(
  API_METHODS.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(channelFor(method), ...args)]),
);

contextBridge.exposeInMainWorld('api', api);
