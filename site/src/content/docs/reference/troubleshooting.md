---
title: Troubleshooting
description: Fixes for common problems with connecting, the World and installing.
sidebar:
  order: 4
---

## Cannot connect

- Check the **Host** and **Port**. For a server on another machine, MySQL must accept remote connections, and a firewall must allow the port.
- Check the MySQL user can connect from your computer and read the world database. A read-only user is enough.
- The error shows in the login screen or Settings; *Access denied* means the user name or password is wrong.

## The World is not drawn

The World is drawn from the **game client folder**. Set it in [Settings](/azeroth-world-editor/reference/settings/) to the folder with `Wow.exe`. The top bar shows **Game client** once it opened. In a busy place the ground and its NPCs can take a few seconds to load.

## No heights, floors or ground snapping

Those come from the **server data folder**: the worldserver's data folder holding `dbc/`, with its `maps/` and `mmaps/` beside it. The top bar shows **Server data** once it opened.

## Spells and models can only be typed as IDs

Searching spells and creature or object models by name needs the **server data folder**.

## Export patch is greyed out

- **Unsafe to export**: the app could not read this quest back exactly as it is in your database, so exporting it could change things you did not touch.
- A module shows an **error** badge: fix what it lists first. Choose the badge to open that module.

## Apply to dev DB is greyed out

Add a dev database in [Settings](/azeroth-world-editor/reference/settings/#dev-database).

## My change does not show in game

Some changes only load after a server restart: new spawns, new or changed patrols and new objects. [Test in game](/azeroth-world-editor/guides/test-in-game/) lists which reload commands your quest needs.

## Editing is greyed out for a moment

An AI assistant connected through [MCP / AI](/azeroth-world-editor/guides/ai-mcp/) is writing to the project. Editing pauses until it finishes, usually under a second, and what you typed is kept. If it stays greyed out, turn off **MCP / AI** in Settings.

## Installing

- **Windows says "Windows protected your PC"**: choose **More info**, then **Run anyway**.
- **macOS will not open it, or says it "is damaged"**: see [Install](/azeroth-world-editor/getting-started/install/#macos).
- **The Linux AppImage does not start**: see [Install](/azeroth-world-editor/getting-started/install/#linux).

## Report a problem

Open an issue on [GitHub](https://github.com/DMCK96/azeroth-world-editor/issues) with your app version, your system, what you did and what happened. A screenshot helps.
