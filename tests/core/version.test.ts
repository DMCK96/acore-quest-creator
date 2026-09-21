import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_VERSION } from '@core/version';

describe('TOOL_VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(TOOL_VERSION).toBe(pkg.version);
  });
});
