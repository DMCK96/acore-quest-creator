# Wowser scene (vendored)

Three.js rendering classes for World of Warcraft terrain and models, copied from
[wowserhq/scene](https://github.com/wowserhq/scene) 0.32.0 (`src/lib`, commit `cbe1211`), which is
MIT licensed: see `LICENSE` and `AUTHORS` here. Parsing comes from `@wowserhq/format` (pinned to
0.25.0, the version this code is written against).

It lives in the repo, and not as a dependency, because the editor changes its insides (buildings,
picking, per-object transforms) and because the published package breaks under Vite's dev server:
its loader workers are found through `new URL('./worker.js', import.meta.url)`, which a pre-bundled
dependency cannot resolve. Here the workers are the `.ts` files beside their loaders.

Type checking is switched off for these files (`// @ts-nocheck`): they were written for a looser
compiler setting than this project's.

## What differs from upstream

- Workers are started from `worker.ts`, not `worker.js` (`model`, `map` and `texture` loaders).
- `diagnostics.ts` is new. A model or terrain tile that cannot be loaded is skipped and reported
  through it, and the rest of the area still draws. Upstream lets one bad file fail the whole area,
  and its streaming loop then stops for good (a blank view).
  - `map/DoodadManager.ts`: models load with `Promise.allSettled`; removing an area copes with a
    doodad whose model never loaded.
  - `map/MapManager.ts`: areas load one by one; a failed one is remembered and not asked for again;
    a failure in one pass cannot end the passes after it.

`npm run test:world3d` runs the 3D code in a browser against a fake game client, including a model
that cannot be read.
