# Ascension custom content: what we have and what is missing

Summary report, 2026-09-25. Scope: Ascension's custom quest content that the
[azerothcore-wotlk-coa](https://github.com/jealous-sound/azerothcore-wotlk-coa) world does not
have, and how much of it the quest creator could import. Method and working figures are in
[ascension-data-import.md](ascension-data-import.md); the scripts are in [scripts/](scripts/).

## Sources

| Source | What it gives |
| --- | --- |
| Client quest cache (ascension-data `cachedata/union/questcache`) | Quest template as the server sent it: levels, flags, objectives, rewards, text |
| Client creature cache (`cachedata/union/creaturecache`) | NPC name, subname, type, family, rank, display IDs, kill credits, quest items |
| Exiles DB export (ascension-data `supplemental/exiles-db-export`) | NPC stats, faction and flags; object templates; spawns (stock x/y/z, custom map %) |
| World catalogue (`cachedata/catalogue`) | One sighting per creature or object, stock-era zones only |
| Addon harvest (`cachedata/lua/harvest/gossips.tsv`) | Quests offered by 15 NPCs in gossip |
| QuestSuperTrack.dbc + SuperTrack.dbc (supplied separately, patch-M.MPQ) | Objective and turn-in points with x/y/z for 11,256 quests |
| CoA world package `coa-world-20260912.zip` + 410 later `pending_db_world` updates | The baseline we compare against |

None of the 410 later CoA updates touch quests; they add 31 NPC templates, counted below.

## Headline

| | Count |
| --- | ---: |
| Ascension quests missing from CoA | 17,402 |
| Playable custom quests (objectives or description text) | **8,431** |
| Title-only quests (hidden tracking quests or stubs) | 8,847 |
| Further custom quests known only by ID and SuperTrack points | 645 |
| Playable quests whose items, NPCs and objects all exist in CoA | 6,543 |
| Playable quests with an ender identified | 6,910 |
| Playable quests with a turn-in point | 2,082 |

CoA has no quest above ID 26,034, so none of Ascension's custom quests are in it.

## By area

### 1. Quest templates: complete

All 8,431 playable quests come from client captures, which carry the quest query response:
levels, sort, type, flags, suggested players, objectives (NPC, object and item targets and
counts, objective texts), rewards (items, choices, money, XP, spell, reputation, title,
talents, honour), start item, next quest in chain, POI, title, objectives, description,
end text and completion text.

**Gaps:** reward (offer-reward) and hand-in (request-items) dialogue, race and class masks,
previous quest, exclusive groups and other server-only columns. None of our sources hold them.

### 2. Givers and enders: mostly inferable

- **Enders from text:** "Return to / Report to / Speak with <name>" matched to known NPCs and
  objects. Tested on 8,329 stock quests: 96% right when it makes a single guess.
- **Enders from turn-in points:** SuperTrack slot 4 is the turn-in point (within 10 yards of
  the real ender for 94% of stock quests). Where a CoA spawn stands on it, that is the ender.
- **Givers:** with "return to" wording the giver is the ender (85% on stock quests). "Seek out"
  and "speak with" wording marks a breadcrumb, so the giver is unknown.

| Playable custom quests | Count |
| --- | ---: |
| Ender from text | 6,733 |
| of which the Hero's Call Board | 4,328 |
| Ender from a CoA spawn at the turn-in point (no text guess) | 177 |
| Text guess confirmed by a CoA spawn at the point | 135 |
| Text guess contradicted by a CoA spawn at the point | 63 |
| Giver inferred (same as ender) | 6,186 |
| **No ender known** | **1,521** |
| of which a turn-in location is known, but not who stands there | 479 |

Texts behind most of the unknowns: "Return to your masters" (228) and "Return to your
trainer" (83).

### 3. Objective targets

| Referenced by playable custom quests | Total | In CoA | Missing |
| --- | ---: | ---: | ---: |
| Items | 4,354 | 4,337 | 17 |
| NPCs | 2,201 | 1,113 | 1,088 |
| Objects | 33 | 0 | 33 |

Of the 1,088 missing target NPCs, 320 appear in no source at all; most are probably
invisible kill-credit triggers.

### 4. NPC templates for the missing NPCs

| Missing NPCs | Total | In creature cache | In Exiles (stats, faction, flags) |
| --- | ---: | ---: | ---: |
| Givers and enders | 523 | 516 | 325 |
| Objective targets | 1,088 | 633 | 333 |

The creature cache gives what the client shows (name, subname, type, family, rank, models).
Levels, faction, NPC flags and stats come only from Exiles; for the rest they must be set by
the author.

### 5. Display IDs

| Missing NPCs | With display IDs | All displays known to the CoA server |
| --- | ---: | ---: |
| Givers and enders | 517 of 523 | 66 |
| Objective targets | 633 of 1,088 | 338 |

"Known to the CoA server" means the ID is in CoA's `creature_template_model` or
`creature_model_info`. Most custom givers use displays CoA has never referenced; whether the
CoA client can draw them must be checked against its `CreatureDisplayInfo.dbc`. The app
already reads client files, so the importer can check this per NPC.

### 6. Spawn points

| Missing NPCs | Total | Placed from turn-in point | Map % (Exiles) | Catalogue sighting | Objective area only | No location |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Givers and enders | 523 | 425 | 23 | 10 | | 92 |
| Objective targets | 1,088 | | 26 | 5 | 396 | 680 |

Columns overlap where an NPC has more than one source; "No location" has none.

- Turn-in points give exact x/y/z for 425 missing givers and enders, covering 1,116 quests.
- SuperTrack objective points give an area for 396 missing target NPCs (888 quests have
  objective points).
- Map-% spawns can be converted to world x/y with the zone bounds and snapped to the ground.

### 7. Objects

- The **Hero's Call Board** (402000 and 412000, questgiver objects, display 138002) ends 4,328
  quests and is not in CoA. Its template is in Exiles. Turn-in points put it at Orgrimmar
  (1, 1579, -4417), Dalaran (571, 5883, 554) and the Twisting Nether (806, 163, 421); the
  catalogue saw it in Darnassus, Dun Morogh, Ironforge, Stormwind, Teldrassil and Westfall.
- 4,384 Ascension object templates are missing from CoA, including all 33 objective objects.
  Object spawns are not published anywhere.

### 8. Custom maps

391 turn-in points of playable custom quests are on Ascension's own maps: Twisting Nether
(806) 288, Azzar Faire (909) 52, Stormwind Sewer (903) 22, Orgrimmar Depths (904) 21 and a few
on 920, 936 and 937. CoA has no spawns on any of them. Those quests only work if the maps
exist in the CoA client and server.

## Remaining gaps, most important first

1. **Reward and hand-in dialogue** for every custom quest. No source; must be written.
2. **Enders for 1,521 quests**, mostly "Return to your masters" and "Return to your trainer".
   Needs a rule per theme or a manual choice.
3. **Display IDs the CoA client may not have**: 451 of 517 custom givers use displays CoA has
   never referenced.
4. **Spawns for 680 missing objective targets and 92 missing givers and enders.** No location in
   any source; placed by hand on the quest map.
5. **NPC stats, level, faction and flags** for 198 givers and 755 targets not in Exiles.
6. **Custom maps**: 391 turn-ins on maps CoA may not have.
7. **Object spawns** for all 4,384 missing objects, the Hero's Call Board included (only three
   exact positions are known).
8. **Race and class masks, previous quest and exclusive groups.** No source; inferable only
   partly from titles and themes.
9. **645 custom quests known only by ID and map points**, with no template at all.

## Also checked: azerothhub.com (Bronzebeard Atlas)

A community map of Ascension's Bronzebeard realm. `robots.txt` allows crawling with a
one-second delay. There is no data API: 5,538 hand-placed markers are bundled in the map's
JavaScript, each with a zone, a type and a position in map percent.

| Marker type | Count | Use to us |
| --- | ---: | --- |
| Worldforge item pickups | 2,989 | None for quests; the same data is in ascension-data `supplemental/worldforged` |
| Mystic Enchant scroll pickups | 2,455 | None for quests |
| Quests | 49 | 43 match playable custom quests, all with chain order (previous/next quest) and a quest-hub position |
| Points of interest, vendors, altars | 45 | Minor |

The 43 quests are starting-zone chains (the Cain Estate in Deathknell, for example). They
fill the previous-quest gap for those chains only. The site holds no NPC spawns, display
IDs, givers or enders.

## Caveats

- Inferred givers and enders are guesses with a measured error rate, not records. The
  importer should show them as suggestions for the author to confirm.
- Ascension renumbered many IDs; a match by ID is only meaningful because CoA imported
  Ascension's items and NPCs under the same IDs.
- No licence is asserted on the game-derived material in ascension-data. The SuperTrack file
  was supplied separately and is not committed here.
