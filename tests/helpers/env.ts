const DEFAULT_AC_SQL_DIR = 'E:\\Repositories\\azerothcore-wotlk-coa\\data\\sql';

export function acSqlDir(): string {
  return process.env.ACQC_AC_SQL_DIR ?? DEFAULT_AC_SQL_DIR;
}

export function mysqlUrl(): string {
  const url = process.env.ACQC_TEST_MYSQL_URL;
  if (!url) throw new Error('ACQC_TEST_MYSQL_URL is not set; integration tests do not skip');
  return url;
}
