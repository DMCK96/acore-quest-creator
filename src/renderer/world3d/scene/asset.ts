// @ts-nocheck
type AssetHost = {
  baseUrl: string;
  normalizePath: boolean;
};

const getAssetUrl = (host: AssetHost, path: string) => {
  const urlPath = host.normalizePath ? normalizePath(path) : path;
  return `${host.baseUrl}/${urlPath}`;
};

const loadAsset = async (host: AssetHost, path: string) => {
  const response = await fetch(getAssetUrl(host, path));

  // Handle non-2xx responses
  if (!response.ok) {
    throw new Error(`Error loading asset: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
};

/**
 * Given an MPQ-style path, return a normalized version of the path with all backslashes turned
 * to forward slashes, leading and trailing whitespace removed, and all characters turned to
 * lowercase.
 *
 * @param path
 */
const normalizePath = (path: string) => path.trim().toLowerCase().replaceAll(/\\/g, '/');

/** A model file as the client stores it: `.mdx` and `.mdl` names are read as `.m2` */
const modelPath = (name: string) => name.replace(/\.(mdx|mdl)$/i, '.m2');

export { AssetHost, getAssetUrl, loadAsset, modelPath, normalizePath };
