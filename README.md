<p align="center">
  <img src=".github/assets/readme-banner.png" alt="ACORE Quest Creator">
</p>

<p align="center">
  <b>Build and script quests for your AzerothCore server, then export them as SQL.</b><br>
  Givers, objectives, scripting, NPCs and patrols, without editing database tables by hand.
</p>

<p align="center">
  <a href="https://github.com/DMCK96/acore-quest-creator/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/DMCK96/acore-quest-creator?style=flat-square&label=release&labelColor=221b15&color=cf9f3f"></a>
  <a href="https://dmck96.github.io/acore-quest-creator/"><img alt="Documentation" src="https://img.shields.io/badge/docs-read%20the%20guide-cf9f3f?style=flat-square&labelColor=221b15"></a>
  <img alt="Windows, macOS and Linux" src="https://img.shields.io/badge/platforms-windows%20%C2%B7%20macos%20%C2%B7%20linux-a99a80?style=flat-square&labelColor=221b15">
  <a href="LICENSE"><img alt="License: GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-a99a80?style=flat-square&labelColor=221b15"></a>
</p>

<p align="center">
  <a href="https://github.com/DMCK96/acore-quest-creator/releases"><b>Download</b></a>
  &nbsp;·&nbsp;
  <a href="https://dmck96.github.io/acore-quest-creator/"><b>Documentation</b></a>
  &nbsp;·&nbsp;
  <a href="#building-from-source"><b>Build from source</b></a>
</p>

<p align="center">
  <img src=".github/assets/divider.svg" alt="" width="800">
</p>

![The quest canvas showing a chain of quests](site/src/assets/screenshots/canvas.png)

## What it does

- **Quest chains on a canvas.** Make new quests or bring in existing chains from your world database, and see how they connect.
- **Givers and objectives.** Choose who offers and takes back a quest, and what the player must kill, use, collect or explore.
- **Quest scripting.** Describe what happens around a quest as scenes: an NPC speaks on accept, a talk option gives credit, an escort walks a path.
- **Combat wizard.** Design how an NPC fights, from one ability to a boss with phases, adds and health thresholds.
- **New NPCs and objects.** Pick how they look, their faction and weapons; make readable books and notes, and chests with loot.
- **Quest map.** Place spawns on the world map with the game's zone art, snap them to the ground and draw patrol routes with actions at each point.
- **Test in game.** Get the GM commands to reload and try a quest on your test server.
- **Export.** Review every change, then export an SQL patch or apply it to a dev database. Your live world database is only ever read.

<table>
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
- Optional: your server's data folder (the one holding `dbc/`) for XP values, name search and ground heights, and your game client folder for map imagery.

## Download

Get the installer for Windows, macOS or Linux from the [Releases page](https://github.com/DMCK96/acore-quest-creator/releases). The builds are not code-signed, so your system warns you the first time you open the app; [the install guide](https://dmck96.github.io/acore-quest-creator/getting-started/install/) shows how to get past it.

## Documentation

The guide for quest authors and contributors: **https://dmck96.github.io/acore-quest-creator/**

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
