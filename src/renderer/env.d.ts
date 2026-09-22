/// <reference types="vite/client" />

import type { Api } from '@shared/ipc';

declare global {
  interface Window {
    /** The preload bridge. Every call answers with a `Result`; none of them reject. */
    readonly api: Api;
  }
}
