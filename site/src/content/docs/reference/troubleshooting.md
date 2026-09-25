---
title: Troubleshooting
description: Fixes for common problems with connecting, the map and installing.
sidebar:
  order: 4
---

## Cannot connect

- Check the **Host** and **Port**. For a server on another machine, MySQL must accept remote connections, and a firewall must allow the port.
- Check the MySQL user can connect from your computer and read the world database. A read-only user is enough.
- The error shows in the login screen or Settings; *Access denied* means the user name or password is wrong.

## The map is blank or has no zone art

The zone art and minimap come from the **game client folder**. Set it in [Settings](/acore-quest-creator/reference/settings/) to the folder with `Wow.exe`. The top bar shows **Game client** once it opened.

## No heights, floors or ground snapping

Those come from the **server data folder**: the worldserver's data folder holding `dbc/`, with its `maps/` and `mmaps/` beside it. The top bar shows **Server data** once it opened.

## Spells and models can only be typed as IDs

Searching spells and creature or object models by name needs the **server data folder**.

## Export patch is greyed out

- **Unsafe to export**: the app could not read this quest back exactly as it is in your database, so exporting it could change things you did not touch.
- A module shows an **error** badge: fix what it lists first. Choose the badge to open that module.

## Apply to dev DB is greyed out

Add a dev database in [Settings](/acore-quest-creator/reference/settings/#dev-database).

## My change does not show in game

Some changes only load after a server restart: new spawns, new or changed patrols and new objects. [Test in game](/acore-quest-creator/guides/test-in-game/) lists which reload commands your quest needs.

## Installing

- **Windows says "Windows protected your PC"**: choose **More info**, then **Run anyway**.
- **macOS says the app "is damaged"**: see [Install](/acore-quest-creator/getting-started/install/#macos).

## Report a problem

Open an issue on [GitHub](https://github.com/DMCK96/acore-quest-creator/issues) with your app version, your system, what you did and what happened. A screenshot helps.
