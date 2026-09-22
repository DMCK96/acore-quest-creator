/**
 * Runs the round-trip gate over every quest in a live world DB.
 *
 * Usage: `ACQC_TEST_MYSQL_URL=mysql://user:pass@host:port/world npm run corpus`
 */
import { writeFileSync } from 'node:fs';
import { openMysqlWorldDb } from '../src/core/db/mysql-world-db';
import { createMysqlScratch } from '../src/core/roundtrip/mysql-gate';
import { runCorpus } from '../src/core/roundtrip/corpus';
import { loadSchema } from '../src/core/schema/load';
import { registry } from '../src/core/registry';

const MAX_QUEST_ID = 4_294_967_295; // int unsigned ceiling; questIdsInRange filters to what exists.

async function main(): Promise<void> {
  const url = process.env.ACQC_TEST_MYSQL_URL;
  if (!url) {
    console.error('ACQC_TEST_MYSQL_URL is not set.');
    process.exit(1);
  }

  const u = new URL(url);
  const conn = {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
  const worldDatabase = u.pathname.slice(1);
  const tables = registry.tables.map((t) => t.table);

  const db = await openMysqlWorldDb({ ...conn, database: worldDatabase });
  const scratch = await createMysqlScratch({ ...conn, worldDatabase, tables });

  try {
    const schema = await loadSchema(db, tables);
    const questIds = await db.questIdsInRange(0, MAX_QUEST_ID);
    process.stderr.write(`Running corpus over ${questIds.length} quests...\n`);

    const report = await runCorpus({
      db,
      schema,
      registry,
      questIds,
      mysql: scratch,
      onProgress: (done, total) => {
        if (done % 100 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`);
      },
    });

    writeFileSync('corpus-report.json', JSON.stringify(report, null, 2));

    console.log(`\nCorpus: ${report.passed}/${report.total} passed, ${report.failures.length} failed.`);
    for (const failure of report.failures.slice(0, 20)) {
      console.log(`  [${failure.stage}] quest ${failure.questId}: ${failure.message}`);
    }
    if (report.failures.length > 20) console.log(`  ...and ${report.failures.length - 20} more (see corpus-report.json)`);

    process.exit(report.failures.length > 0 ? 1 : 0);
  } finally {
    await scratch.drop();
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
