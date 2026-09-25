# Research scripts

Throwaway Python used for `../ascension-data-import.md`, kept so the numbers can be
re-run. They expect a working folder holding:

- `ascension-data/`: a clone of hertigservices/ascension-data
- `t/tables/`: the Exiles export CSVs (`coa-public-2026-09-13-tables.tar`)
- `wdb/`: the union quest and creature caches, fetched with `fetch_cache.py`
- `cw/`: the unzipped `coa-world-20260912.zip`, loaded into `coa.sqlite` with `load_sql.py`
- `coa/`: a sparse clone of azerothcore-wotlk-coa with `data/sql/updates`
- `playable.json`: the playable custom quest IDs from the gap analysis

`infer2.py` is the giver/ender inference and its validation against stock quests.
