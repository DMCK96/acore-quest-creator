---
title: Working with an AI assistant (MCP)
description: Let an AI assistant connected over MCP research the world and build quests, NPCs and spawns in your open project.
sidebar:
  order: 14
---

Azeroth World Editor can run an [MCP](https://modelcontextprotocol.io/) server, so an AI assistant (Claude Code, Claude Desktop, or any other MCP client) can work in the project you have open: look things up in your world, draft a quest chain, place NPCs, and export a patch. You watch it happen, and anything it does can be undone.

It is off until you turn it on.

## Turn it on

1. Open **Settings** and choose the **MCP / AI** tab.
2. Tick **Allow AI to edit this project**.
3. The tab shows the **address** and a **token**. Press **Show** to see the token, or **Copy token** to copy it.

The server only listens on this computer (`127.0.0.1`), and every request must carry the token. **Make a new token** replaces it at once; a client using the old one is refused.

## Connect an assistant

Any MCP client that supports HTTP servers needs two things: the address, and the header `Authorization: Bearer <your token>`.

For Claude Code, press **Copy Claude Code command** and run it in a terminal. It looks like this:

```sh
claude mcp add --transport http awe http://127.0.0.1:47600/mcp --header "Authorization: Bearer <your token>"
```

Connect the editor to your world database first, as you do for any work. The assistant can also connect for you using one of your saved connections. Then ask for what you want.

## What the assistant can do

- **Look things up:** quests, NPCs, objects, items and spells by name; who stands where; what a quest chain links to.
- **Write quests:** start a new quest, import an existing one, set its fields, and check it for problems. Quest text is written in English.
- **Make NPCs, objects and items,** or take over an existing one and change it.
- **Place and move spawns,** set patrol routes, movement and respawn times in the World.
- **Export:** write a quest's or the project's SQL patch into your export folder.
- **Undo and redo.**

## What it cannot do

- It never writes to your world database, and it cannot apply a patch to your dev database. You apply patches yourself, as always.
- It has no access to your connection passwords.

## Undoing its work

Every change the assistant makes is one step in **History**, named **AI: …** (for example *AI: edit quest 60001*). The open quest, the quest graph and the World update as it works. Undo with **Ctrl+Z** or from History, like any other change. See [Undo and redo](/azeroth-world-editor/guides/undo/).

## Things to try

- *"Build a quest chain in Elwynn Forest for level 10, and make it lore accurate."*
- *"I have an idea for a legendary weapon and a quest chain to get it. Help me brainstorm and fit it in with the rest of the world."*
- *"Find every quest between levels 8 and 12 near Goldshire and tell me what's missing."*
