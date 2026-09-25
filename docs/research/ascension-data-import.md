# Importing from Ascension Data: what is available

Research note, 2026-09-25. Source: [hertigservices/ascension-data](https://github.com/hertigservices/ascension-data)
and the [AscensionDB](https://ascension-db.ascension-archive.workers.dev/) site built from it.

## Gap analysis: custom Ascension content vs azerothcore-wotlk-coa

Compared against [jealous-sound/azerothcore-wotlk-coa](https://github.com/jealous-sound/azerothcore-wotlk-coa)
`data/`: the world package `coa-world-20260912.zip` plus the 410 files in
`data/sql/updates/pending_db_world` that its `baseline.json` does not list as covered.
Ascension side: the union client quest and creature caches (Release packs) and the Exiles
DB export CSVs.

### Pending updates

- 490 files in `pending_db_world`; the world package covers 80, leaving 410.
- The 410 are mostly spells (`spell_proc` in 192 files, `spell_script_names` in 173,
  `spell_bonus_data` in 47) and NPC models (`creature_template` 40, `creature_template_model` 32).
- **None touch a quest table.** Together they add 31 creature templates and no object templates.
  Those 31 are counted as present below.

### Quests

The CoA world has 9,464 quests, all in the stock range (highest ID 26,034). Every quest
in the Ascension sources is either in that set or missing; CoA has no quest Ascension lacks.

| Ascension quests missing from CoA | Count |
| --- | ---: |
| Total missing | 17,402 |
| In the stock ID range (below 30,000) | 1,002 |
| Custom ID range (30,000 and above) | 16,400 |
| Same title as a CoA quest (renumbered copies) | 76 |
| Test or deprecated titles | 48 |
| Title only, no text (hidden tracking quests or stubs) | 8,847 |
| **Playable-looking: objectives or description text** | **8,431** |

All 8,431 playable ones come from client captures, so their template fields (levels,
objectives, rewards, text) are available. By level: 2,552 at 0 to 9 (mostly scaling or
level-less), 1,121 at 10 to 59, 1,355 at 60s, 2,855 at 70s, 548 at 80. Main themes by title
prefix: Population Control 1,126, Short on Supplies 456, Seal the Deal 390, Arms Dealer 272,
WotLK Daily Template 222, Path to Ascension 214, A Delicate Situation 141, Tier 1 to 13 Fel
Challenge 25 each, and 2,798 with no prefix.

**None of the 8,431 has a known giver or ender.** The Exiles giver tables only cover quests
CoA already has. Offer-reward and request-items text is also absent for all of them.

### What those quests reference

| Referenced by playable custom quests | Total | Present in CoA |
| --- | ---: | ---: |
| Items (required, source, reward, choice, start item) | 4,354 | 4,337 |
| NPC targets | 2,201 | 1,113 (1,088 missing, 432 of those unknown in any source) |
| Object targets | 33 | 0 |

Per quest: 6,543 have every NPC, object and item reference already in CoA; 1,849 are missing
an NPC, 19 an object, 13 an item and 7 both an NPC and an object.

### NPCs, objects and spawns

- Creatures: CoA 31,250 templates; Ascension sources 57,985; 26,778 missing (15,683 of them
  with IDs of 100,000 or more).
- Objects: CoA 21,599 templates; Exiles 25,965; 4,384 missing.
- Only 310 of the missing creatures have any spawn in the Exiles export, 1,354 rows, and
  those are the custom placements with zone-map percentages but no world coordinates.
  Custom NPC spawns will need placing by hand (our quest map can do this).

### What this means for the importer

- Items are covered by CoA already, so an import can reference them directly.
- About 6,500 custom quests can be imported with all references resolving today.
- Every imported custom quest needs a giver and ender chosen by the author, and its
  reward and hand-in text written.
- About 1,900 need NPCs or objects created first; creature cache records can seed the
  NPC template (name, subname, type, family, rank, display ids), but not stats or spawns.

## General survey

## The two useful sources

### 1. Exiles DB export (`supplemental/exiles-db-export/`)

The PostgreSQL database behind `db.exil.es`, a CoA database site. 97 tables, 6.19M rows,
published as one SQL dump (69 MB gz) and as one gzipped CSV per table (a 59 MB tar).
It is shaped like TrinityCore/aowow, not AzerothCore, so every table needs mapping.

| Table | Rows | Relevance |
| --- | ---: | --- |
| `quest` | 18,625 | Quest template: levels, flags, rewards and requirements (JSONB arrays), text |
| `creature_quest_starts` / `_ends` | 7,430 / 7,859 | Givers and enders |
| `quest_startend` | 10,616 | Start/end links (type 1 only, i.e. creatures) |
| `quest_objective_hotspot` | 2,715 | Where objectives happen, as zone-map percentages |
| `creature` | 43,213 | creature_template shape: display ids, faction template, flags, levels, stats |
| `creature_spawn` | 153,064 | 151,710 with raw world x/y/z; 1,354 custom ones with only map percentages |
| `gameobject` | 25,965 | Template only. `gameobject_spawn` and `gameobject_quest_*` are empty |
| `creature_loot`, `gameobject_loot` | 4.27M / 19k | Aggregated drop views, explicitly not server loot tables |

How complete the quest rows are (measured on the CSV export):

| Field | Filled |
| --- | ---: |
| Title | 100% |
| Objectives / details | 47% |
| Completed text | 37% |
| Offer-reward / request-items text | 0% |
| Required items | 70% |
| Required NPC or object | 10% |
| Reward items / choice items / factions | 61% / 11% / 30% |
| Race mask | 27% |
| Class mask, previous quest, POI | 0% |
| Next quest | 17% |
| Has an NPC giver / ender | 38% / 42% |

19% of quests are Ascension custom ids (900,000 and above).

### 2. Client quest cache captures (`cachedata/**/questcache.tsv.gz`)

Players' `questcache.wdb` files, decoded. Each record is the server's quest query
response, with AzerothCore-style names (`QuestLevel`, `RewardItem1`, `RequiredNpcOrGo1`,
`ObjectiveText1`, `PointMapId`...). The main CoA mode has 18,554 quests; the catalog
holds 150,422 quest records across all modes and variants. Bulk files are in GitHub
Releases (fetched via `datasets/cache.json`), and single records are served as JSON by
the catalog service (`catalog/snapshots/<id>/records/<file>/<part>.json.gz`).

This is the more trustworthy source for the quest itself: the repo says captured data
wins where the two disagree. It lacks what the query response never carries: givers and
enders, race/class masks, previous quest, offer-reward and request-items text.

## What AscensionDB's own "Convert to SQL" does

It does not write `quest_template`. It creates `ascension_quest_*` staging tables with the
raw JSON, and a separate server script that only updates the reward columns of quests
the world database already has, with a journal for rollback. So it is not a replacement
for our importer.

## How much of our workflow it can fill

| Our step | Covered | From |
| --- | --- | --- |
| Quest template: levels, sort, flags, type, title, objectives, details, completion text | Yes | Cache capture, Exiles as fallback |
| Objectives: kill/use targets, collect items, objective texts | Yes | Cache capture |
| Rewards: items, choices, money, XP difficulty, spell, factions, title, talents | Yes | Cache capture |
| POI (continent, x, y) | Partly | Cache capture `PointMapId/X/Y` where set |
| Givers and enders | About 40% | Exiles `creature_quest_starts/ends`; objects not at all |
| Chain links (next quest) | Partly | Cache `NextQuestInChain`, Exiles `next_quest_id` (17%) |
| Previous quest, exclusive groups, race/class masks | Mostly no | Race mask for 27% only |
| Offer-reward and request-items text | No | Not in either source |
| NPCs referenced by the quest | Mostly | Exiles `creature` (template fields) and creature cache |
| NPC spawns for the quest map | Yes for stock-style spawns | Exiles `creature_spawn` x/y/z |
| Object spawns, waypoints, SmartAI, conditions, loot tables | No | Not published |

Rough estimate: the quest form itself (template, objectives, rewards) can be filled almost
entirely. Relations, chains and NPCs are partial and need review. Scripting, patrols,
object spawns and loot remain manual.

## Cautions

- IDs are in Ascension's renumbered space. Custom items, NPCs and display ids will not exist
  in a stock or CoA repack world database unless imported too, so imported quests need a
  reference check against the connected database.
- `creature_loot` must not be loaded as a loot table (flattened world drops, sums over 300%).
- No licence is asserted on the game-derived material; the export is provided for preservation.
- The Exiles export is PostgreSQL, so we would read the CSV tables (or a converted local
  file) rather than add a Postgres driver.
