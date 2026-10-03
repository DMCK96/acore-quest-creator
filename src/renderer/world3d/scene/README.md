# Wowser scene (vendored)

For what the 3D editor is for, what works and what is next, see [docs/3d-editor.md](../../../../docs/3d-editor.md).

Three.js rendering classes for World of Warcraft terrain and models, copied from
[wowserhq/scene](https://github.com/wowserhq/scene) 0.32.0 (`src/lib`, commit `cbe1211`), which is
MIT licensed: see `LICENSE` and `AUTHORS` here. Parsing comes from `@wowserhq/format` (pinned to
0.25.0, the version this code is written against).

The liquid code (`map/liquid/`, `map/loader/liquid.ts`) is adapted from
[Adrinalin4ik/world-of-warcraft](https://github.com/Adrinalin4ik/world-of-warcraft) and
[Kruithne/wow.export](https://github.com/Kruithne/wow.export), both MIT: their notices are in
`map/liquid/LICENSE`. Every outside project, with what came from it, is listed in
[CREDITS.md](../../../../CREDITS.md).

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
  - `texture/TextureManager.ts`: a texture that cannot be loaded is replaced by a plain grey one, so
    its model or terrain still draws (upstream drops the whole model). It is logged to the console
    only, not reported in the view: nothing is left out, and modded clients lack many by design.
    `getOptional` quietly asks for one that may not exist (a flipbook's frames past its last).
  - `texture/loader/TextureLoaderWorker.ts`: a texture that cannot be read is reported with its size
    and first bytes; uncompressed (ARGB) textures are converted to RGBA, which upstream rejects;
    mip slots the file cannot really have (past the levels its size allows, or running off its end)
    are cleared, because some files leave garbage there and the reader trusts every slot.
  - The grey stand-in for a texture that cannot be loaded is opaque: leaves and fences are
    alpha-tested, and a see-through stand-in removed them.
  - `model/ModelAnimation.ts`: a model whose stand animation has no first variation (some have only
    variations 1 and 2) plays the first it has; upstream threw and the model was left out.
  - `model/ModelMaterial.ts`: a texture transform with no animation state leaves the texture where it
    is; upstream threw inside the render loop, which stopped the whole view.
  - `map/light/util.ts`: two band keys at the same time give the first one's colour; upstream left the
    colour unwritten.
  - `model/shader/fragment.ts`: the four combiners upstream lacks (`Mod_Mod2xNA`, `Mod_AddNA`,
    `Add_Mod`, `Mod2x_Mod2x`); a model using one drew without its textures.

## What is added

- `wmo/`: buildings (WMO), which upstream does not draw. `wmo/format` holds the building's root-file reader
  from `@wowserhq/format` 0.28.0 (MIT), copied because the 0.25.0 this code is written against lacks
  it, plus the material blend mode, which the published reader drops. Group files are read by
  `wmo/format/group.ts`, written here: the published reader throws on chunk sizes that are not
  whole numbers of floats and on a group whose batches are all see-through, and real files have both. `wmo/loader` parses a building and
  its group files in a worker; `wmo/WmoManager.ts` draws one mesh per group, with `wmo/WmoMaterial.ts`:
  lit by the map's light and fogged like the terrain, with a group's baked lighting (vertex colours)
  added to the ambient. Ascension's later buildings (its Stormwind, the Kul Tiras docks) carry dark or
  black baked colours that only make sense on top of the sun; drawn as the only light, they were
  black. The lighting law follows Kruithne/wow.export (MIT, see `map/liquid/LICENSE`). The
  area loader now passes on the buildings an area places (`objDefs`), which it used to drop.
  Not drawn yet: the props inside buildings (doodad sets), water inside buildings (`MLIQ`), the
  building shaders beyond a plain diffuse texture (two-layer, environment, emissive), and interior
  lighting (interior groups are lit by the sun like the rest).
- `map/liquid/` and `map/loader/liquid.ts`: water, ocean, magma and slime on the terrain, which
  upstream does not draw. The area loader reads the ADT's `MH2O` chunk (which `@wowserhq/format` finds
  but does not read) into one mesh per liquid type per area. Types come from `LiquidType.dbc`
  (`db/LiquidTypeRecord.ts`, a record the package lacks), so a client's own types draw as it defines
  them. Each type's material plays its flipbook (as many frames as exist), tints water with the light
  database's river or ocean colour (`map/light` now blends those bands and LightParams' water
  alphas), and draws magma and slime unlit and solid. Water is as see-through as the database's
  shallow alpha at its edges and solid where it is deep: the client darkens what lies under deep
  water, which is not done here. Not done yet: water inside buildings, the underwater look, and
  waves or reflections.
- `../world3d.ts` switches Three's colour management off, as wowserhq's own viewer (spelunker) does.
  With it on, every light colour was darkened to linear and never brightened back, and the world was
  drawn too dark and too red.

`npm run test:world3d` runs the 3D code in a browser against a fake game client, including a model
that cannot be read and a tile covered in magma.
