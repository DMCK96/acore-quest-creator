---
title: Environment variables
description: The .env file and ACQC_* variables, for running ACORE Quest Creator from source.
sidebar:
  order: 2
---

These are for running the app from source (`npm run dev`) and for its tests. **The installed app ignores `.env`**; set things up on the login screen instead.

## The `.env` file

Copy `.env.example` to `.env` in the repository. When you run the app from source, it saves these values as a **World (.env)** profile and fills in the login screen with them, so you only choose **Connect**.

| Variable | Meaning |
| --- | --- |
| `ACQC_WORLD_DB_HOST` | World database host. |
| `ACQC_WORLD_DB_PORT` | World database port (default `3306`). |
| `ACQC_WORLD_DB_USER` | World database user. |
| `ACQC_WORLD_DB_PASSWORD` | World database password. |
| `ACQC_WORLD_DB_DATABASE` | World database name. |
| `ACQC_WORLD_DB_DBC_DIR` | Optional. The server's data folder holding `dbc/`. |
| `ACQC_WORLD_DB_CLIENT_DIR` | Optional. The game client folder. |
| `ACQC_DEV_DB_HOST` | Optional. Dev database host; leave empty to skip the dev database. |
| `ACQC_DEV_DB_PORT` | Dev database port (default `3306`). |
| `ACQC_DEV_DB_USER` | Dev database user. |
| `ACQC_DEV_DB_PASSWORD` | Dev database password. |
| `ACQC_DEV_DB_DATABASE` | Dev database name. |

Variables already set in your shell win over the file.

## Other variables

| Variable | Meaning |
| --- | --- |
| `ACQC_ENV_FILE` | Read another file instead of `.env`, or `none` to read no file. |
| `ACQC_USER_DATA` | Use this folder for the app's data instead of the usual one. Tests set it to a fresh folder so they never touch your own. |
| `ACQC_OUTPUT_DIR` | Where **Export patch** writes SQL files. |
| `ACQC_RECOVERY_INTERVAL_MS` | How often the recovery copy is saved, in milliseconds (default `30000`). |

## Test variables

| Variable | Meaning |
| --- | --- |
| `ACQC_TEST_MYSQL_URL` | The world database for integration and end-to-end tests, as `mysql://user:password@host:port/database`. |
| `ACQC_AC_SQL_DIR` | The AzerothCore `data/sql` folder, for integration tests that read the base SQL. |

See [Testing](/acore-quest-creator/contributing/testing/).
