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
  - `texture/TextureManager.ts`: a texture that cannot be loaded is reported and replaced by a plain
    grey one, so its model or terrain still draws (upstream drops the whole model).
  - `texture/loader/TextureLoaderWorker.ts`: a texture that cannot be read is reported with its size
    and first bytes; uncompressed (ARGB) textures are converted to RGBA, which upstream rejects;
    mip slots the file cannot really have (past the levels its size allows, or running off its end)
    are cleared, because some files leave garbage there and the reader trusts every slot.
  - The grey stand-in for a texture that cannot be loaded is opaque: leaves and fences are
    alpha-tested, and a see-through stand-in removed them.
  - `model/shader/fragment.ts`: the four combiners upstream lacks (`Mod_Mod2xNA`, `Mod_AddNA`,
    `Add_Mod`, `Mod2x_Mod2x`); a model using one drew without its textures.

## What is added

- `wmo/`: buildings (WMO), which upstream does not draw. `wmo/format` holds the building's root-file reader
  from `@wowserhq/format` 0.28.0 (MIT), copied because the 0.25.0 this code is written against lacks
  it, plus the material blend mode, which the published reader drops. Group files are read by
  `wmo/format/group.ts`, written here: the published reader throws on chunk sizes that are not
  whole numbers of floats and on a group whose batches are all see-through, and real files have both. `wmo/loader` parses a building and
  its group files in a worker; `wmo/WmoManager.ts` draws one mesh per group. Groups with baked
  lighting (vertex colours) are drawn unlit with it; the others are lit by the scene's lights. The
  area loader now passes on the buildings an area places (`objDefs`), which it used to drop.
  Not drawn yet: the props inside buildings (doodad sets), water, fog on buildings, and per-batch
  render states beyond blend mode.

`npm run test:world3d` runs the 3D code in a browser against a fake game client, including a model
that cannot be read.
