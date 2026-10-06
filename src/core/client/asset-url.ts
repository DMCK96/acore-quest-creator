/**
 * The address of one game client file as the 3D view asks for it: `awe-wow://file/<path>`, where
 * the path is the client's own, lower-cased with forward slashes (`world/maps/azeroth/azeroth.wdt`).
 * MPQ lookups ignore case and the kind of slash, so the path is passed on as it came.
 */

import { ASSET_SCHEME } from './schemes';

export { ASSET_SCHEME };
const PREFIX = `${ASSET_SCHEME}://file/`;

/** The client path an address names; null for another scheme, an empty path or one that climbs out. */
export function parseAssetUrl(url: string): string | null {
  if (!url.startsWith(PREFIX)) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(PREFIX.length).split(/[?#]/, 1)[0]!);
  } catch {
    return null;
  }
  if (path === '' || path.split(/[\\/]/).some((part) => part === '..')) return null;
  return path;
}

/** The address for a client path; the inverse of `parseAssetUrl`. */
export function assetUrl(path: string): string {
  return PREFIX + path.split('/').map(encodeURIComponent).join('/');
}

/** What the 3D view is given as its asset host: files are `<base>/<path>`. */
export const ASSET_BASE_URL = `${ASSET_SCHEME}://file`;
