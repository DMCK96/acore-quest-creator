/**
 * The app's own URL schemes, served by the main process. Each name lives here only; the renderer's
 * Content-Security-Policy (`src/renderer/index.html`) is the one place that must spell them out again.
 */

/** Game client files for the 3D view: `awe-wow://file/<client path>` */
export const ASSET_SCHEME = 'awe-wow';
