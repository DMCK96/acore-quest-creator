---
title: Projects and the quest canvas
description: Lay out quest chains on the canvas, bring in existing quests and save your work as a project.
sidebar:
  order: 1
---

After you connect, the app opens on the **World**. Your quests are in the **Quests** dock: choose **Quests** in the top bar and it opens under the World (or beside it: see **Preferences** in [Settings](/azeroth-world-editor/reference/settings/)). It holds the **canvas**, with every quest in your project as a card and lines showing which quest leads to which. Drag the bar between the World and the dock to resize it. Opening a quest from anywhere opens the dock; opening and closing it keeps both where you left them. **Find a quest**, among the quest tools, searches the database for a quest to open.

![The canvas showing a chain of quests, each a card linked to the next](../../../assets/screenshots/canvas.png)

## Add quests

- **New quest** makes a quest from scratch and opens it straight away.
- **Add existing quest** searches your world database by name or ID. Picking one brings in its **whole chain**: the quest you picked and every quest chained to it.

Choose a card to preview the quest in a panel on the right: its giver, objectives, dialogue, rewards and more at a glance. The open quest's card lists its NPCs and objects (givers, enders and objectives); the one you selected in the World, or last went to, is marked. From the preview, **Edit quest** opens it, **Remove from canvas** takes it off the canvas (your database is not touched) and **Close preview** hides the panel.

## Find your way around

- Drag the canvas to move around; scroll to zoom.
- **Fit view**, with **New quest** and **Add existing quest** in the quest tools at the top left, zooms to show every quest.
- The small map in the corner shows where you are on a large canvas.

When you are inside a quest, **← Back to chain** returns to the canvas.

## Projects

Everything in the app, the quests and your changes to the world, is one **project**. Choose **Project** in the top bar to:

- **Save** or **Save As…** the project as an `.awe` file (projects saved as `.aqc` by older versions open too),
- **Open…** another project, or pick one from **Recent projects**,
- start a **New project…**.

The project's name shows in the top bar, with a dot beside it while there are unsaved changes. Closing the app with unsaved changes asks whether to save.

:::tip[Recovering unsaved work]
The app keeps a recovery copy of your work in the background. If it closes unexpectedly, it offers to restore that work the next time you connect.
:::
