/**
 * Reads the world DB settings out of `.env` text so the screenshot run can refuse to start without
 * a database, instead of capturing empty screens. Values are taken literally: Windows paths keep
 * their backslashes.
 */
export interface WorldDbEnv {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  dbcDir?: string;
  clientDir?: string;
}

function parseEnv(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1);
    vars.set(line.slice(0, eq).trim(), value);
  }
  return vars;
}

export function worldDbFromEnv(text: string): WorldDbEnv {
  const vars = parseEnv(text);
  const get = (key: string): string => vars.get(`ACQC_WORLD_DB_${key}`) ?? '';
  const host = get('HOST');
  const database = get('DATABASE');
  if (!host || !database) throw new Error('Set ACQC_WORLD_DB_HOST and ACQC_WORLD_DB_DATABASE in .env to take screenshots');
  const env: WorldDbEnv = {
    host,
    port: get('PORT') ? Number(get('PORT')) : 3306,
    user: get('USER'),
    password: get('PASSWORD'),
    database,
  };
  if (get('DBC_DIR')) env.dbcDir = get('DBC_DIR');
  if (get('CLIENT_DIR')) env.clientDir = get('CLIENT_DIR');
  return env;
}
