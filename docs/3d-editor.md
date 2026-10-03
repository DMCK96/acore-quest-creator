# 3D editor: plan and progress

A living document. Update it in the same change as the work it describes.

Last updated: 2026-10-03. Branch: `claude/vigilant-volta-ebcgyr`.

## Goal

The tool grows from a quest creator into a 3D editor for the world around the quests:

- See the game world in 3D, drawn from the user's own game client (terrain, props, buildings, and later NPCs and objects).
- Place and edit **NPCs**, **objects** and **patrol paths** in that view: move patrol points, move NPCs, and move, rotate and scale objects with 3D gizmos.
- Make the 3D view the focus of the app, and reshape the quest grid into a tool for building and managing quest chains.
- The 3D view works on its own, with no quest open.

Other people have built similar editors but not shared the code. We are not copying anyone's code unless its licence allows it (see [Where the code comes from](#where-the-code-comes-from)).

## How it works

- The 3D view reads files straight from the game client's MPQ archives (the app already opens them for the quest map). A custom `acqc-wow://file/<path>` address, served by the main process (`src/main/index.ts`), hands them to the page. Nothing is extracted or hosted.
- Drawing is done with Three.js. The terrain, props and animated models come from Wowser's scene classes, which now live in `src/renderer/world3d/scene/` (see the README there for exactly what differs from upstream).
- World units are the server's: yards, X north, Y west, Z up. A spawn's `position_x/y/z` is its place in the 3D view with no conversion.
- The loaders run in Web Workers; the main thread only builds Three.js objects.
- Entry points:
  - **3D view** button in the top bar: `src/renderer/world3d/World3DScreen.tsx` (pick a continent, go to X/Y/Z).
  - **3D view** toggle in the quest map: same view, starting where the map was looking.
  - The scene itself: `src/renderer/world3d/world3d.ts`.

## Where the code comes from

| What | Source | Licence | How it is used |
| --- | --- | --- | --- |
| Terrain, props, animated models, camera controls | [wowserhq/scene](https://github.com/wowserhq/scene) 0.32.0 | MIT | Copied into the repo (`src/renderer/world3d/scene/`), licence and authors kept, with our changes listed in its README |
| File parsers (terrain, models, textures, tables) | `@wowserhq/format` 0.25.0 | MIT | npm dependency, pinned |
| Building root-file reader | `@wowserhq/format` 0.28.0 | MIT | A few files copied into `scene/wmo/format/` (0.25.0 lacks them) |
| Building group reader | Written here | n/a | `scene/wmo/format/group.ts` (the published one throws on real files) |
| Building renderer | Written here, reading the format of buildings (WMO) | n/a | `scene/wmo/` |
| Water, ocean, magma, slime | Adapted from [Adrinalin4ik/world-of-warcraft](https://github.com/Adrinalin4ik/world-of-warcraft) and [Kruithne/wow.export](https://github.com/Kruithne/wow.export) | MIT (both) | `scene/map/liquid/`, `scene/map/loader/liquid.ts`; both notices in `scene/map/liquid/LICENSE` |

Every outside project, with what came from it and where its notice is kept, is listed in [CREDITS.md](../CREDITS.md). Add to it in the same change whenever code is ported or adapted.

Looked at and **not** used: `wowserhq/client` (it is the game's UI layer), `vjeux/jsWoWModelViewer` (no licence file, so not copied), `Coldensjo/Ironforge` (the closest in purpose, but WoW Classic and no licence file: design reference only), `Deamon87/WebWowViewerCpp` (the most complete liquid renderer, but no licence: read only).

## Status

### Done

- 3D view of a continent's terrain, props (trees, fences, carts) and buildings, from the user's client. Verified on the user's client for terrain, props and buildings; later fixes below are verified against a fake client only (see Testing).
- A **3D view** button in the top bar, working with no quest open: four continents, each opening on solid ground, plus go-to X/Y/Z. Also a toggle in the quest map.
- Robustness, because real clients are messier than the format specs:
  - One bad model, building or terrain tile is skipped and reported; the rest still draws. The view lists what was left out, the console has the full list, and the terminal running the app logs each client file that was asked for and missing.
  - A texture that cannot be read or is missing becomes an opaque grey stand-in, so its model or terrain still draws. Textures are logged to the console only, not listed in the view: nothing is left out, and modded clients such as Ascension's lack many by design.
  - A model whose stand animation starts past its first variation (some ported Ascension models have only variations 1 and 2) plays the first one it has.
  - Leaving a world, or changing continent, cannot take the view down; a failure inside the view stays inside it.
  - Sound is switched off (the library would play zone music).
  - A model whose texture transform has no animation leaves its texture still; it used to stop the whole view (seen at Stormwind Harbor).
- Water, ocean, magma and slime on the terrain, read from the map's `MH2O` data, with their types from the client's `LiquidType.dbc` (so CoA's own types draw too). Animated flipbooks, water tinted by the light database's river and ocean colours, see-through at the edges and solid where deep, magma and slime glowing and solid.
- Colours as the game has them: Three's colour management is off, as in wowserhq's own viewer. With it on, the whole world was drawn too dark and too red.
- Buildings lit by the map's light and fogged like the terrain, with baked lighting added on top. Ascension's later buildings (its Stormwind, the Kul Tiras docks) have dark or black baked lighting and drew black before.
- Format fixes: uncompressed textures, texture files with garbage in unused mip slots, four model material types the library lacked, building group files with unusual chunk sizes or all see-through batches.
- A browser test that runs the real 3D code against a fake game client (`npm run test:world3d`).

### Known gaps

Things that are missing or approximate. Roughly in order of how much they matter.

1. **No NPCs or objects.** The map files only hold terrain, trees and fixed buildings. NPCs and objects (a mailbox, a chest, a quest giver) are spawns in the world database, drawn by looking up a display ID in the client's tables. None of that is built yet. This is why the mailbox in Northshire is not there.
2. **No editing at all yet.** The 3D view is look-only: no selection, no gizmos, no patrol points.
3. **Props inside buildings** (furniture in the Abbey) are not drawn. Buildings carry them as "doodad sets".
4. **Textures the client does not ship.** The user's client places custom modern-expansion buildings (Kul Tiras, Draenor, Dragonflight) whose textures are not in its archives; those parts draw grey. Not loose in the `Data` folder either. Where the references come from is not established; reports now name the building or model that asked, so the next run will show it.
5. **Tree leaves are unconfirmed on real data.** Three causes were found and fixed (see the commit `e8972f1`), and each fix has a test, but it has not yet been confirmed on the user's client. The original `Invalid typed array length: 4294791348` texture error is believed to come from garbage in unused mip slots; if canopies are still grey, the report now includes the file's size and first bytes.
6. **Buildings are approximate:** two-sided, one diffuse texture per batch (the game's two-layer, environment and emissive building shaders are not done), and interior parts are lit by the sun like the rest. They are lit by the map's light and fogged like the terrain, with baked lighting added on top. The same building placed in two neighbouring tiles is drawn twice (identical, so it does not flicker, but it costs).
7. **Water is terrain-only and approximate.** Water inside buildings (canals, fountains, Stormwind's inner harbour pools) is not drawn yet. There is no underwater look, no waves or reflections, and deep water is simply made solid instead of darkening what is under it as the client does.
8. **Memory:** the library cannot stop its workers, so each continent switch leaves two idle workers behind; loaded buildings and models are cached for the life of the page.
9. **Only the four continents.** Dungeons and battlegrounds need their own map-file handling.
10. **Not run in the full app in this sandbox.** There is no game client or world database here, so the Electron app has not been driven end to end by us; the user runs it and reports. The 56 test files that need `ACQC_AC_SQL_DIR` (the AzerothCore SQL files) cannot run here, and failed identically before and after our changes.

### Things the data model limits (affects the editing plan)

- A spawn stores position and a single facing angle (`o`). Objects in AzerothCore also store a rotation quaternion, so full rotate (tilt) is possible, but the app does not keep it yet.
- **Scale** belongs to the object *template* (`size`), not to a spawn. Scaling one object in the 3D view would change every spawn of that object. The editor should say so before it does that.

## Next steps

In order. Each is meant to be a step the user can try before the next begins.

1. **Spawn layer.** Show the creature and object spawns near the camera (and a chosen quest's spawns) in 3D: read them from the database, find each model through the client's display tables (the repo already reads them in `src/core/game/displays.ts`), draw them, and label them. This brings in the mailbox. Needs: model lookup for creatures and objects, and loading models by display ID.
2. **Selection and the move gizmo.** Click to select a spawn or patrol point; drag arrows to move it; drop it on the ground (the server's own floor heights, as the quest map does); every edit through the same change path the quest map uses, so undo, export and "changes" keep working.
3. **Patrol paths in 3D.** Draw a patrol as a line with points; move, add and delete points; keep the existing actions at points.
4. **Rotate, and scale.** Facing first; then tilt for objects; scale with the template-wide warning.
5. **Reshape the quest grid** into a chain builder beside the 3D view. Needs a design conversation first: what "managing a chain" should mean day to day.
6. **Fill the gaps** above as they get in the way: props inside buildings first, then water inside buildings, then the remaining building shaders.

Open questions for the user:

- Should the 3D view open on the quest's own spawns when launched from a quest, or always on the last place looked?
- Is it acceptable for scale edits to change the template (and so every spawn of it)?
- Which continent matters most after Eastern Kingdoms, so test data and checks lean that way?

## Testing

- `npm run typecheck`, `npm test` (unit tests), `npm run build`.
- `npm run test:world3d`: opens the real 3D code in a browser (software WebGL, no graphics card needed) against a fake game client (`tests/world3d/fake-client.ts`): one terrain tile, textures, a building of four groups, and deliberately broken files. It checks that terrain and a building are on screen, that broken files are reported by name and do not stop the rest, that worlds can be left and reopened, and that every model shader compiles. Set `PW_CHROMIUM` to a Chromium binary if Playwright's own is not installed; set `WORLD3D_SHOT=<file.png>` to keep the picture it takes.
- Every fix so far was checked to fail with the old code and pass with the fix. Keep doing that: the failures here are silent (an empty view), so a test that only passes proves little.
- Not covered by any automated test: real game data. The user's client is the only real check; ask them to restart `npm run dev` (config and worker changes need a full restart), look at the same spot, and send back the "could not be loaded" lines.

## Working notes

- In `npm run dev` the page reloads on source changes, but worker and config changes need a full restart.
- A message in the 3D view reading "N things could not be loaded" is the first place to look; each entry says what failed. Missing textures are only in the console, each with the building or model that wanted it.
- Do not commit generated files, the user's game files or anything from a game client; the fake client builds its own test data.
