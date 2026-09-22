import type { SchemaInfo } from '../db/types';
import type { WorldDb } from '../db/world-db';
import { buildPatch } from '../export/build-patch';
import { renderPatch } from '../export/render-patch';
import { importQuest } from '../import/importer';
import type { Registry } from '../registry/types';
import { TOOL_VERSION } from '../version';
import type { MysqlScratch } from './mysql-gate';
import { verifyPatchInMysql } from './mysql-gate';
import { verifyRoundTrip, type FidelityReport } from './verify';
import type { Difference } from './compare';

export interface CorpusFailure {
  questId: number;
  stage: 'import' | 'roundtrip' | 'mysql';
  message: string;
  differences?: Difference[];
}

export interface CorpusReport {
  total: number;
  passed: number;
  failures: CorpusFailure[];
}

export interface RunCorpusDeps {
  db: WorldDb;
  schema: SchemaInfo;
  registry: Registry;
  questIds: readonly number[];
  mysql?: MysqlScratch;
  verify?: typeof verifyRoundTrip;
  onProgress?: (done: number, total: number) => void;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Runs the round-trip gate over every quest ID given, recording one failure per quest rather than
 * aborting the run. When `mysql` is supplied, a passing in-memory round trip is also verified
 * against a real MySQL scratch schema by rendering and applying the patch there.
 */
export async function runCorpus(deps: RunCorpusDeps): Promise<CorpusReport> {
  const { db, schema, registry, questIds, mysql, verify = verifyRoundTrip, onProgress } = deps;
  const total = questIds.length;
  const failures: CorpusFailure[] = [];
  let passed = 0;

  for (let i = 0; i < questIds.length; i++) {
    const questId = questIds[i];
    try {
      const { aggregate, snapshot } = await importQuest(db, schema, registry, questId);

      let report: FidelityReport;
      try {
        report = verify({ aggregate, snapshot, schema, registry });
      } catch (err) {
        failures.push({ questId, stage: 'roundtrip', message: errorMessage(err) });
        onProgress?.(i + 1, total);
        continue;
      }

      if (!report.ok) {
        failures.push({ questId, stage: 'roundtrip', message: 'Round trip is not lossless', differences: report.differences });
        onProgress?.(i + 1, total);
        continue;
      }

      if (mysql) {
        try {
          const sql = renderPatch(
            buildPatch({ aggregate, snapshot, schema, registry }).statements,
            schema,
            { toolVersion: TOOL_VERSION, questId, date: new Date().toISOString().slice(0, 10).replace(/-/g, '_') },
          );
          const mysqlReport = await verifyPatchInMysql(mysql, {
            snapshot,
            patchSql: sql,
            expected: snapshot.tables,
            schema,
            registry,
          });
          if (!mysqlReport.ok) {
            failures.push({ questId, stage: 'mysql', message: 'MySQL round trip is not lossless', differences: mysqlReport.differences });
            onProgress?.(i + 1, total);
            continue;
          }
        } catch (err) {
          failures.push({ questId, stage: 'mysql', message: errorMessage(err) });
          onProgress?.(i + 1, total);
          continue;
        }
      }

      passed++;
    } catch (err) {
      failures.push({ questId, stage: 'import', message: errorMessage(err) });
    }
    onProgress?.(i + 1, total);
  }

  return { total, passed, failures };
}
