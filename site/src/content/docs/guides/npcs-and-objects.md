---
title: NPCs and objects
description: Make new NPCs and objects for your project, change ones the database already has, choose how they look, and give NPCs a faction and weapons.
sidebar:
  order: 5
---

An NPC, object or [item](/azeroth-world-editor/guides/items/) belongs to your project, not to one quest. A quest uses it by naming it: as its giver or ender, an objective, a reward, or in a script. It is the same NPC whether one quest uses it, several do, or none, and whether you made it or the database already had it.

A quest's **NPCs, objects & items** module lists the project's NPCs, objects and items in two parts. **Used by this quest** comes first: the ones this quest names. **Others in the project** lists the rest. Each row says what changed (**New**, **Spawns changed**, **Movement changed**, **Path changed**, **Details changed**, **Group changed**) and which quests use it. The module appears as soon as the project has any. Making a new NPC from the [Quest Giver](/azeroth-world-editor/guides/givers-and-enders/) module adds it to the quest for you.

- **Add NPC**, **Add object** and **Add item** make a new one for the project and open its editor.
- **Add from project…** lists the project's NPCs, objects and items, and gives the one you pick a part in this quest.
- **Edit** on a listed row opens it. The row says which other quests use it, so you know what a change affects.

A new NPC or object is in the project as soon as you add it, and every change is kept as you make it. **Discard** on a new one takes it away again. Deleting one tells you which quests use it, and takes it off their giver and ender cards. Like every change, both are undone with **Ctrl+Z**.

You can also make them straight in [the World](/azeroth-world-editor/guides/the-world/#new-npcs-and-objects): right-click the ground and choose **New NPC here…** or **New object here…**.

## Change one that already exists

You can edit an NPC, object or item the database already has. Open its editor from the right-click menu in the World (**Edit NPC…** or **Edit object…**), from its row in the entity list, or from a picker's **Edit…** button, such as the one beside the giver. This needs the world database connected, since the editor reads the current values from it.

The editor is the same one a new NPC gets, with its title ending in **(existing)**, such as **NPC: Stormwind Guard (existing)**. The first edit adds the NPC to your project as one undo step, and the row in the entity list reads **Details changed**. Nothing in the database changes until you apply the project patch. The patch writes the NPC's row with your changes laid over it, so everything the editor does not show stays as the database had it, and a revert patch puts the original rows back.

**Put back as the database has it** (where a new NPC has **Discard**) takes your changes away and removes the NPC from the project's list. It is one undo step too.

Before a change that reaches further than this one NPC, the editor says so:

- On scale, and the NPC's other details, when it has more than one spawn: the warning names how many spawns the change affects.
- On the **Loot** tab, when other NPCs share the same loot list: the warning names how many.

Some parts are read-only, with a line saying why:

- **Fight**, when the database already scripts the NPC (a scripted fight). Nothing you could set here would take effect.
- **Loot**, when the loot list has references to other lists or groups.
- An object whose type the editor does not have.

An existing NPC's spawns are not in the editor. Change them in the World: move them, set their [respawn time](/azeroth-world-editor/guides/the-world/#place-copy-and-paste), wander and paths.

If the database has changed the NPC's rows since you first edited it, **Project changes** says so, so check before you apply the patch: applying it overwrites those changes.

## The NPC editor

![The New NPC editor on its Look & gear tab, borrowing a Stormwind Dock Worker's look and wrench](../../../assets/screenshots/npc-editor.png)

The editor has tabs:

- **Basics**: name, title (the line under the name), minimum and maximum level, and faction. Faction buttons such as **Stormwind** set a common one in a click. Under **Visibility**, set who sees it and when it is in the world (see [Visibility](#visibility) below).
- **Look & gear**: how the NPC looks. Type a creature under **Look like…** to borrow its appearance. Tick **and its weapons** to borrow its weapons too, or **and its level, faction and rank** to borrow those. **Other ways** lets you browse models by name or type a display ID. **Scale** makes it bigger or smaller. Under **Weapons** you can pick main hand, off hand and ranged items yourself; armour always comes with the look.

:::note[Weapons only need a display]
An NPC holds a weapon by its item's display alone, so any item works, even one your database lists without a proper name (it may show as `[MISSING ITEM NAME]`). The NPC still holds it in game.
:::
- **Fight**: how it fights. See the [combat wizard](/azeroth-world-editor/guides/combat-wizard/).
- **Loot**: what it drops. See [Loot](/azeroth-world-editor/guides/loot/).
- **Vendor**: what it sells. See [Selling things](#selling-things) below.
- **Trainer**: the spells it teaches. See [Teaching spells](#teaching-spells) below.
- **Gossip**: what it says when talked to. See [Talking](#talking) below.
- **Placement**: where it stands. **Add spawn** and paste the output of the in-game `.gps` command, or choose **Place in world** to put it down in [the World](/azeroth-world-editor/guides/the-world/#your-own-npcs-from-their-editor). Each spawn has its own **Event**, which starts as **Same as the NPC**.

### Selling things

Any NPC can be a vendor, a new one or one the database already has. On the **Vendor** tab, **Make this NPC a vendor** adds the first row, and **Add item** adds more. Each row is one thing it sells:

- **Item**: pick it by name or ID. Under it, the item's buy price is shown, since that is what a player pays in gold.
- **Max count**: how many it has, up to 255. **0 is unlimited**.
- **Restock (seconds)**: how long until the stock comes back after it sells out. It only applies to limited stock, so it is switched off while **Max count** is 0, and it starts at 900 (fifteen minutes) when you limit an item. The server does not load limited stock with no restock time, so leaving it at 0 is an error.
- **Extended cost**: the honor, arena points or tokens it asks for besides gold, picked by what it costs, such as *2000 honor + 1 Mark of Honor*. These come from the server data folder's `ItemExtendedCost.dbc`; without that folder you type the cost's ID instead. Leave it empty for gold alone. If the folder has no readable `ItemExtendedCost.dbc`, the field says why and takes the ID as a number. A cost the file does not have is a warning, since the server would skip the item. New costs cannot be made here.

**Up** and **Down** set the order the items are shown in, and **Remove** takes one away. **Copy stock from…** replaces the list with another NPC's, new or from the database, and asks first when this NPC already sells things.

An NPC the database already makes a vendor opens with its stock listed, ready to edit. Opening it changes nothing; the patch writes the stock only if you change it, and the revert patch puts the original rows back. An NPC added to a project before the app could read stock does not show its stock; choose **Put back as the database has it** and edit the NPC again to read it. An NPC with any stock is made a vendor, and with none it is not. Its other flags (such as a reagent or food vendor) stay as the database has them.

In [the World](/azeroth-world-editor/guides/the-world/#the-right-click-menu), right-click an NPC and choose **Make vendor…**, or **Edit vendor stock…** when it already sells things; both open this tab. Checks: an item listed twice with the same extended cost, or a row with no item, is an error; an item the database and the project do not have is a warning.

Some vendors in the database list a negative item: that is not an item but another vendor's whole list. It is kept and shown as such. The server reads at most 150 things for one vendor, so a longer list is a warning.

Changing the stock back to what it was when you opened the NPC writes nothing. If you had already applied a patch with other stock to your database, run that patch's revert file to undo it.

Stock that depends on a game event is not edited here.

### Teaching spells

Any NPC can be a trainer, a new one or one the database already has. On the **Trainer** tab, **Make this NPC a trainer** gives it a trainer of its own, and then:

- **Type**: **Class**, **Mount**, **Profession** or **Pet**.
- **Class** (class and pet trainers): which class it serves. With no class chosen, every class can train there, which the editor warns about since it is rarely meant. The stock classes are listed by name; the fork's own classes show as **Class N**.
- **Greeting**: what the trainer says when a player opens the window.
- Each spell has a **Spell**, a **Cost** in gold, silver and copper, a **Required level**, an optional **Skill** (or its **Skill id**, for one the list has no name for) and **Skill rank** (for professions), and up to three **Needs spell** entries, the spells a player must already know.

**Add spell** adds a row and **Remove** takes one away. **Copy spells from…** replaces the list with another NPC's, new or from the database, together with its type, class and greeting, and asks first when this NPC already teaches something. **Remove trainer** makes the NPC teach nothing again.

An NPC the database already makes a trainer opens with its spells listed, ready to edit. Opening it changes nothing; the patch writes the trainer only if you change it, and the revert patch puts the original rows back. Most class trainers share one trainer with many other NPCs (one mage trainer serves every mage trainer in the world). Changing a shared trainer would change them all, so the editor shows its spells read-only, says how many other NPCs use it, and offers **Give it its own copy**. **Remove trainer** is still there: it makes only this NPC stop teaching and leaves the shared trainer alone. That gives this NPC a trainer of its own with the same spells, which you can then edit; the shared trainer is never touched.

This database also keeps an older table of shared spell lists, `npc_trainer`. If an NPC uses some, the tab says so ("Also teaches the spells of N shared lists"). They are shown but not edited here. An NPC added to a project before the app could read trainers does not show its trainer; choose **Put back as the database has it** and edit the NPC again to read it.

In [the World](/azeroth-world-editor/guides/the-world/#the-right-click-menu), right-click an NPC and choose **Make trainer…**, or **Edit trainer spells…** when it already teaches; both open this tab. Checks: a spell row with no spell, the same spell twice, a spell that needs itself, a trainer with no ID, a trainer ID that another NPC already uses (in the database or in the project), and an edit that would overwrite a trainer other NPCs use are errors; a class trainer with no class, an empty trainer, a spell the server does not have, and an edit to a shared trainer that is not written are warnings.

Translated greetings are not edited here.

### Talking

Any NPC can have a gossip menu: the window that opens when a player talks to it. On the **Gossip** tab, **Give this NPC a gossip menu** adds a greeting and turns **Can be talked to** on. A menu has:

- **Greeting**: one or more variants, each with a **Text**, a **Female text** (optional) and a **Chance**. One is chosen by weight each time. **Add variant** and **Remove variant** change the list.
- **Options**: each with an **Icon** (the symbol beside it), its **Text**, and what it **Does**: **Closes the window**, **Opens menu…** (another menu of this NPC, a **New menu…**, or a menu ID the database has), or opens a service window: **Vendor**, **Flight master**, **Trainer**, **Innkeeper**, **Banker**, **Petitions**, **Tabard designer**, **Battlemaster**, **Auctioneer**, **Stable master**, **Armorer** or **Unlearn talents**. A service sets its icon when the icon is 0. **Remove** takes an option out, and **Add option** gives a new one the next id, never one the menu had before. The game shows options in the order of their ids, so they cannot be reordered here. An option can open the menu it is in. **Remove menu** takes a menu out of the NPC's tree (not the first); an option that still opens it is an error.

A service option shows only to an NPC that can do it, so an existing NPC that is not a vendor, trainer or the like gets a note, with a button that goes to the **Vendor** or **Trainer** tab. A new NPC is given the other flags (innkeeper, banker, flight master and so on) its options need when it is exported.

An NPC the database already gives a menu opens with it loaded, with every menu its options open. Opening it changes nothing; the patch writes only the menus you change, and the revert patch puts the original rows back. Many NPCs share their menu with others (an object can too: a quest giver or a goober), so a shared menu shows read-only, says how many other NPCs or objects use it, and offers **Give it its own copy** (and **Copy the whole menu tree**). A tree of more than 24 menus is read only that far, and a menu past that which links back counts as another user, so such a tree shows read-only. A menu that only a shared menu opens is shared too, and so is a menu whose greeting another menu of the same tree also uses; **Give it its own copy** takes the shared menus above it along, so the copy can be reached. A copy is a new menu with the same content; a map marker, a money box or a translation on an option stays with the original.

Some options are **kept as they are**: the database ties them to a condition (for example, only one faction sees it) or to a script (something happens when it is picked). Their text and icon can change; they cannot be removed or made to do something else, and neither can the menu that holds one. Scripts and conditions are not edited here.

Changing the text of an option or a greeting clears its translations, so other-language clients show the new text. **Remove gossip menu** makes only this NPC stop having one, even when the menu is shared or holds a kept option (those rows stay). **Copy menu from…** replaces the tree with a copy of another NPC's.

In [the World](/azeroth-world-editor/guides/the-world/#the-right-click-menu), right-click an NPC and choose **Add gossip menu…**, or **Edit gossip menu…** when it has one; both open this tab. Checks: an option with no text, a greeting nothing could choose, two options of one menu with the same ID, an option that opens a menu the same edit removes, a menu or text ID that another NPC or object already uses (in the database or in the project), an edit that would overwrite a menu others use, and a kept option that was removed are errors; a greeting variant with no text, a service the NPC cannot do (or an option with no flag, which the server never shows), a menu no option reaches, an option opening a menu that does not exist, a menu that cannot be opened because **Can be talked to** is off, and an edit to a shared menu that is not written are warnings.

A quest scene that is started by a gossip option adds its option to the first menu of the tree made here, on the next free option id, and the quest patch numbers anything it makes clear of the project's menus. For an NPC with no menu it makes its own.

### Visibility

- **Seen by**: **Living players** (the default), **Dead players only**, or **Living and dead players**. A spirit healer is seen only by dead players. This is part of the NPC itself, so it applies to every spawn of that NPC. A spirit healer or spirit guide in the database is always dead-only, and the choice is locked.
- **Event**: when its spawns are in the world. **Always**, **Only during…** or **Gone during…**, then pick one or more game events by name. A spawn that follows several events is there while any of them runs (or gone while any of them runs). Every spawn follows this unless it has its own event, set on the **Placement** tab or with **Event…** in the [3D view's right-click menu](/azeroth-world-editor/guides/the-world/#the-right-click-menu). For an NPC the database already has whose spawns follow different events, **As each spawn has it** leaves them as they are.

An NPC that gives quests but is seen only by dead players gets a warning, since living players could not take or hand in its quests. The export warns when an event is not in the database, and when a spawn follows events of its own while also in a [spawn group](/azeroth-world-editor/guides/spawn-groups/) that follows an event, since the server applies both.

## The object editor

Objects have **Basics**, **Look**, **Placement**, and for some types **Contents**. On **Basics**, pick the **Type**:

| Type | What it is |
| --- | --- |
| Usable object | Something the player clicks, such as a lever or a quest item on the ground. Can show pages of text. |
| Lootable | Something the player loots, such as a chest. Its **Contents** tab holds its loot. |
| Quest giver | An object that offers or takes back quests, such as a wanted poster. |
| Readable | A book, note or plaque. See [Readable objects](/azeroth-world-editor/guides/readable-objects/). |
| Decoration | Scenery with nothing to use. |

Usable and lootable objects can be **Only usable while this quest is in the log**.

On **Look**, **Other ways** lets you **Browse models** by name, such as `chest` or `book`.

:::tip
Without the [server data folder](/azeroth-world-editor/getting-started/connect/#folders-optional), models and spells cannot be searched by name. Type their IDs instead.
:::
