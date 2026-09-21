import { contextBridge } from 'electron';

// Placeholder bridge. The typed, zod-validated IPC surface replaces this in a later task.
contextBridge.exposeInMainWorld('acqc', { shell: 'electron' });
