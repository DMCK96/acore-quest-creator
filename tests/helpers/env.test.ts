import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { acSqlDir } from './env';

describe('acSqlDir', () => {
  it('points at the AzerothCore sql directory with base db_world schemas', () => {
    expect(existsSync(join(acSqlDir(), 'base', 'db_world', 'quest_template.sql'))).toBe(true);
  });
});
