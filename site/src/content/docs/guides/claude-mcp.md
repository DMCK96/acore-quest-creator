---
title: Working with Claude
description: Let Claude, or any MCP client, research the world and build quests, NPCs and spawns in your open project.
sidebar:
  order: 14
---

Azeroth World Editor can run an [MCP](https://modelcontextprotocol.io/) server, so an assistant such as Claude can work in the project you have open: look things up in your world, draft a quest chain, place NPCs, and export a patch. You watch it happen, and anything it does can be undone.

It is off until you turn it on.

## Turn it on

1. Open **Settings** and choose the **Claude** tab.
2. Tick **Allow Claude to edit this project**.
3. The tab shows the **address** and a **token**. Press **Show** to see the token.

The server only listens on this computer (`127.0.0.1`), and every request must carry the token. **Make a new token** replaces it at once; a client using the old one is refused.

## Connect Claude

For Claude Code, press **Copy command for Claude Code** and run it in a terminal. It looks like this:

```
claude mcp add --transport http awe http://127.0.0.1:47600/mcp --header "Authorization: Bearer <your token>"
```

Other MCP clients that support HTTP servers need the address, and the header `Authorization: Bearer <your token>`.

Connect the editor to your world database first (as you do for any work), then ask for what you want.

## What Claude can do

- **Look things up:** quests, NPCs, objects, items and spells by name; who stands where; what a quest chain links to.
- **Write quests:** start a new quest, import an existing one, set its fields, and check it for problems. Quest text is written in English.
- **Make NPCs, objects and items,** or take over an existing one and change it.
- **Place and move spawns,** set patrol routes, movement and respawn times in the World.
- **Export:** write a quest's or the project's SQL patch into your export folder.
- **Undo and redo.**

## What Claude cannot do

- It never writes to your world database, and it cannot apply a patch to your dev database. You apply patches yourself, as always.
- It has no access to your connection passwords.

## Undoing Claude's work

Every change Claude makes is one step in **History**, named **Claude: …** (for example *Claude: edit quest 60001*). The open quest, the quest graph and the World update as it works. Undo with **Ctrl+Z** or from History, like any other change. See [Undo and redo](/azeroth-world-editor/guides/undo/).

## Things to try

- *"Build a quest chain in Elwynn Forest for level 10, and make it lore accurate."*
- *"I have an idea for a legendary weapon and a quest chain to get it. Help me brainstorm and fit it in with the rest of the world."*
- *"Find every quest between levels 8 and 12 near Goldshire and tell me what's missing."*
