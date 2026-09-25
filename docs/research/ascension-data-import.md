# Importing from Ascension Data: what is available

Research note, 2026-09-25. Source: [hertigservices/ascension-data](https://github.com/hertigservices/ascension-data)
and the [AscensionDB](https://ascension-db.ascension-archive.workers.dev/) site built from it.

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
