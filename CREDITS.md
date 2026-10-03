# Credits

ACORE Quest Creator builds on other people's work. This page lists every outside project whose code is
in this repository, under what licence, and where its notice is kept, followed by the projects and
references we learned from without copying code. When code is ported or adapted from another project,
add it here in the same change.

## Code in this repository

| Project | Author | Licence | What we use | Where | Notice |
| --- | --- | --- | --- | --- | --- |
| [wowserhq/scene](https://github.com/wowserhq/scene) 0.32.0 (commit `cbe1211`) | Wowser contributors ([fallenoak](https://github.com/fallenoak), [timkurvers](https://github.com/timkurvers)) | MIT | The 3D view's Three.js terrain, model, texture, light and sound classes, vendored and changed | `src/renderer/world3d/scene/` | `src/renderer/world3d/scene/LICENSE`, `AUTHORS` |
| [wowserhq/format](https://github.com/wowserhq/format) 0.28.0 | Wowser contributors | MIT | The building (WMO) root-file reader, copied because the pinned 0.25.0 lacks it; the DBC string reader, copied into `LiquidTypeRecord` because it is not exported | `src/renderer/world3d/scene/wmo/format/`, `scene/db/LiquidTypeRecord.ts` | `src/renderer/world3d/scene/LICENSE` |
| [Adrinalin4ik/world-of-warcraft](https://github.com/Adrinalin4ik/world-of-warcraft) (commit `2922f92`) | Alex Panfilkin | MIT | Water, magma and slime: how a liquid surface is laid out as a mesh, its flipbook advanced by elapsed time, the river and ocean tint taken from the light bands, magma and slime drawn unlit | `scene/map/liquid/`, `scene/map/loader/liquid.ts` | `src/renderer/world3d/scene/map/liquid/LICENSE` |
| [Kruithne/wow.export](https://github.com/Kruithne/wow.export) (commit `c2fd7bd`) | Kruithne, Marlamin | MIT | Liquid colour and see-through law (tint plus texture, alpha from shallow to deep), texture coordinates (world position × 0.06; magma's own × 3/256), magma's flow; building lighting (baked colours added to the ambient and sun, not used as the only light) | `scene/map/liquid/shader/`, `scene/map/loader/liquid.ts`, `scene/wmo/WmoMaterial.ts` | `src/renderer/world3d/scene/map/liquid/LICENSE` |

Each adapted file also names its source in a comment at its top.

## Learned from, no code copied

- [AzerothCore](https://github.com/azerothcore/azerothcore-wotlk) map extractor (`src/tools/map_extractor/adt.h`): the WotLK `MH2O` liquid layout.
- [wowdev.wiki](https://wowdev.wiki/): file formats (`ADT/v18`, `DB/LiquidType`).
- [Deamon87/WebWowViewerCpp](https://github.com/Deamon87/WebWowViewerCpp) and [ClassicWowMapExplorer](https://github.com/Coldensjo/ClassicWowMapExplorer): looked at for how others draw liquid. Neither has a licence, so nothing was taken from them.
