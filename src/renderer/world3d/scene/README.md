# Wowser scene (vendored)

How the 3D view is put together, and the rules it keeps, is in the [architecture page](https://dmck96.github.io/azeroth-world-editor/contributing/architecture/#the-3d-view).

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

Type checking is switched off for upstream's own files (`// @ts-nocheck`): they were written for a
looser compiler setting than this project's. The folders written or rewritten here are checked:
`wmo/`, `map/liquid/`, `spawn/`, `character/`, `edit/`, `diagnostics.ts`, `model/animator-tracks.ts`.
A file taken on here loses its `@ts-nocheck` in the same change.

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
  - `model/ModelManager.ts`, `model/look.ts`: a model can be drawn in a look: files for its replaceable
    texture slots (a creature's skin, an NPC's baked clothes and hair) and the geosets to show (one
    hairstyle, not all). Upstream left replaceable slots blank. Looks share the model's buffers and
    animation; each choice of geosets gets its own draw groups.
  - `model/ModelAnimation.ts`: a model whose stand animation has no first variation (some have only
    variations 1 and 2) plays the first it has; upstream threw and the model was left out.
  - `model/ModelMaterial.ts`: a texture transform with no animation state leaves the texture where it
    is; upstream threw inside the render loop, which stopped the whole view.
  - `map/light/util.ts`: two band keys at the same time give the first one's colour; upstream left the
    colour unwritten.
  - `model/shader/fragment.ts`: the four combiners upstream lacks (`Mod_Mod2xNA`, `Mod_AddNA`,
    `Add_Mod`, `Mod2x_Mod2x`); a model using one drew without its textures.

## What is left out

- Upstream's camera controls (`controls/`: `OrbitControls`, `MapControls`, `BaseOrbitControls`) are
  not kept: the 3D view has its own camera (`../controls.ts`).
- Upstream's sound (`sound/`, the zone music, and the `@tweenjs/tween.js` fades it used) is not
  kept: an editor plays no music. `MapManager` no longer takes a sound manager.
- Upstream's `index.ts`, which re-exported every class, is not kept: import each file directly.

## What is added

- Furniture and props inside buildings (WMO doodad sets): `wmo/format/io/root.ts` reads `MODD`
  and `MapObj` its sets and doodads; `map/loader/adt-chunks.ts` reads each placement's doodad set
  from `MODF`, which @wowserhq/format reads and drops. `wmo/doodads.ts` places a building's default
  set and its placement's set in the world, and `MapManager` hands them to the `DoodadManager` with
  the area's own doodads (batched and culled the same way), tagged `inside` so they hide with the
  buildings (`DoodadManager.setInteriors`).
- `worker/SceneWorkerController.ts` can be disposed (`dispose()`): its worker is stopped, and requests
  still waiting never settle. `MapManager.dispose()` stops the map, building and model loaders'
  workers; upstream left them running, so every change of map left them behind. The texture and
  table managers are shared by every map (`sharedManagers` in `../world3d.ts`) and are not stopped.



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
  A group's water (`MLIQ`, read in `wmo/format/group.ts`) is turned into a liquid spec in the
  building's space by `wmo/loader/liquid.ts` and drawn with the terrain's liquid materials, as part of
  the building. Not drawn yet: the props inside buildings (doodad sets), the building shaders beyond a plain diffuse texture (two-layer, environment, emissive), and interior
  lighting (interior groups are lit by the sun like the rest).
- `map/liquid/` and `map/loader/liquid.ts`: water, ocean, magma and slime on the terrain, which
  upstream does not draw. The area loader reads the ADT's `MH2O` chunk (which `@wowserhq/format` finds
  but does not read) into one mesh per liquid type per area. Types come from `LiquidType.dbc`
  (`db/LiquidTypeRecord.ts`, a record the package lacks), so a client's own types draw as it defines
  them. Each type's material plays its flipbook (as many frames as exist), tints water with the light
  database's river or ocean colour (`map/light` now blends those bands and LightParams' water
  alphas), and draws magma and slime unlit and solid. Water is as see-through as the database's
  shallow alpha at its edges and solid where it is deep: the client darkens what lies under deep
  water, which is not done here. Buildings' water (canals, fountains, moonwells) uses the same
  materials. It has no depth, so it is drawn half way between shallow and solid. Not done yet: the
  underwater look, and waves or reflections.
- `character/`: dressed humanoids, which upstream does not draw. `composite.ts` paints layers into the 3.3.5 body texture's regions (scaled for larger skins); `outfit.ts` holds which geosets items show; `CharacterTexture.ts` reads and decodes the layers (with the app's own BLP decoder) and registers the built texture with the `TextureManager` under a path of its own (`register`), so models ask for it like any other.
- `spawn/`: the world database's NPCs and objects near the camera, which upstream does not draw.
  `DisplayResolver` turns a display id into a model, its replaceable skins and its geosets, from the
  client's own tables (record classes in `db/records.ts`, each reading the field count the Ascension
  client's file has); humanoids are their race's body in their baked texture with one hairstyle;
  weapons come from `Item.dbc` and `ItemDisplayInfo`. `SpawnManager` draws one group per area (only
  the camera's and the eight round it, within 100 yards), with markers for what cannot be drawn, and
  patrol routes and wander circles (`paths.ts`). `MapManager` gives it the doodads' model manager and
  the buildings' manager, so spawned models animate with the doodads. NPCs walk their paths and wander
  circles while the scene's one `MovementControl` plays (`walkers.ts` tracks each drawn NPC with a
  `MovementDriver` over the walkers in `core/world/walk/`); on a docked vessel they walk the deck, and
  their routes are drawn through the vessel's frame (not picked there, so not edited yet). The vessel never moves.
  - `model/attachments.ts` reads a model's attachment points from the raw M2 (the format package
    drops them); `Model.attachmentObject` follows a point's bone, for held weapons.
- `edit/`: editing, which upstream does not do. `Gizmo.ts` puts Three's own `TransformControls` on a
  stand-in and copies it onto the spawn or route point being edited (the map's groups do not update
  their matrices themselves); `route.ts` and `history.ts` are the route rules and undo, without Three.
  `SpawnManager` draws the world layer's edits over the database, and routes edited in the view until
  the host stores them.
- `../world3d.ts` switches Three's colour management off, as wowserhq's own viewer (spelunker) does.
  With it on, every light colour was darkened to linear and never brightened back, and the world was
  drawn too dark and too red.

`npm run test:world3d` runs the 3D code in a browser against a fake game client, including a model
that cannot be read and a tile covered in magma.
