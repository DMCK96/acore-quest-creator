<p align="center">
  <img src=".github/assets/readme-banner.png" alt="Azeroth World Editor (AWE)">
</p>

<p align="center">
  <b>A world editor for your AzerothCore server: build quests and shape the world around them, then export it all as SQL.</b><br>
  Quests, scripting, NPCs and objects, spawns and patrols in 3D, without editing database tables by hand.
</p>

<p align="center">
  <a href="https://github.com/DMCK96/azeroth-world-editor/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/DMCK96/azeroth-world-editor?style=flat-square&label=release&labelColor=221b15&color=cf9f3f"></a>
  <a href="https://dmck96.github.io/azeroth-world-editor/"><img alt="Documentation" src="https://img.shields.io/badge/docs-read%20the%20guide-cf9f3f?style=flat-square&labelColor=221b15"></a>
  <img alt="Windows, macOS and Linux" src="https://img.shields.io/badge/platforms-windows%20%C2%B7%20macos%20%C2%B7%20linux-a99a80?style=flat-square&labelColor=221b15">
  <a href="LICENSE"><img alt="License: GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-a99a80?style=flat-square&labelColor=221b15"></a>
</p>

<p align="center">
  <a href="https://github.com/DMCK96/azeroth-world-editor/releases"><b>Download</b></a>
  &nbsp;·&nbsp;
  <a href="https://dmck96.github.io/azeroth-world-editor/"><b>Documentation</b></a>
  &nbsp;·&nbsp;
  <a href="#building-from-source"><b>Build from source</b></a>
</p>

<p align="center">
  <img src=".github/assets/divider.svg" alt="" width="800">
</p>

![The World: Northshire Abbey in 3D, drawn from the game client, with Marshal McBride selected](site/src/assets/screenshots/world.png)

## What it does

- **The world in 3D.** Walk the game world from your client files; place, move and turn NPCs and objects, draw their paths, set respawn times and build spawn groups, then export the changes as a project patch.
- **Quest chains on a canvas.** Make new quests or bring in existing chains from your world database, and see how they connect.
- **Givers and objectives.** Choose who offers and takes back a quest, and what the player must kill, use, collect or explore.
- **Quest scripting.** Describe what happens around a quest as scenes: an NPC speaks on accept, a talk option gives credit, an escort walks a path.
- **Combat wizard.** Design how an NPC fights, from one ability to a boss with phases, adds and health thresholds.
- **New NPCs and objects.** Pick how they look, their faction and weapons, who sees them (the living, only the dead like a spirit healer, or both) and the game events their spawns follow; make readable books and notes, and chests with loot.
- **Quest map.** Place spawns on the world map with the game's zone art, snap them to the ground and draw patrol routes with actions at each point.
- **Test in game.** Get the GM commands to reload and try a quest on your test server.
- **Export.** Review every change, then export an SQL patch or apply it to a dev database. Your live world database is only ever read.

<table>
  <tr>
    <td width="50%"><img src="site/src/assets/screenshots/route-before.png" alt="Before: a Stormwind Guard's stock route cuts across the grass north of Goldshire"></td>
    <td width="50%"><img src="site/src/assets/screenshots/route-after.png" alt="After: the same stretch of route moved onto the road"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Before</b>: the stock route leaves the road north of Goldshire</sub></td>
    <td align="center"><sub><b>After</b>: dragged back onto the road, one entry in Project changes</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="site/src/assets/screenshots/canvas.png" alt="The Quests canvas showing a chain of quests"></td>
    <td width="50%"><img src="site/src/assets/screenshots/world-menu.png" alt="The World's right-click menu"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Quests</b>: chains on a canvas</sub></td>
    <td align="center"><sub><b>Right-click</b>: what you can do with what is under the cursor</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="site/src/assets/screenshots/scripts.png" alt="Quest scripting: scenes around a quest"></td>
    <td width="50%"><img src="site/src/assets/screenshots/combat.png" alt="The combat wizard designing a fight"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Quest scripting</b>: what happens around a quest, as scenes</sub></td>
    <td align="center"><sub><b>Combat wizard</b>: from one ability to a boss with phases</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="site/src/assets/screenshots/quest-map.png" alt="The quest map with spawns placed in Elwynn Forest"></td>
    <td width="50%"><img src="site/src/assets/screenshots/npc-editor.png" alt="The NPC editor choosing how an NPC looks"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Quest map</b>: spawns and patrols on the zone art</sub></td>
    <td align="center"><sub><b>NPC editor</b>: looks, faction and weapons</sub></td>
  </tr>
</table>

## Requirements

- An [AzerothCore](https://www.azerothcore.org/) world database (including the Conquest of AzerothCore fork) reachable over MySQL.
- Recommended: your game client folder, which the 3D World is drawn from (without it, the app is the quest tools only).
- Optional: your server's data folder (the one holding `dbc/`) for XP values, name search and ground heights.

## Download

Get the installer for Windows, macOS or Linux from the [Releases page](https://github.com/DMCK96/azeroth-world-editor/releases). The builds are not code-signed, so your system warns you the first time you open the app; [the install guide](https://dmck96.github.io/azeroth-world-editor/getting-started/install/) shows how to get past it.

## Documentation

The guide for quest authors and contributors: **https://dmck96.github.io/azeroth-world-editor/**

## Building from source

```sh
npm ci
cp .env.example .env   # then fill in your world database
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for tests, conventions and releases.

<p align="center">
  <img src=".github/assets/divider.svg" alt="" width="800">
</p>

## License

[GPL-3.0-or-later](LICENSE).
