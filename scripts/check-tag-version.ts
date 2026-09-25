/**
 * Stops a release whose tag does not match `package.json`, before any installer is built.
 *
 * Usage: `npm run release:check-tag -- v0.2.0` (the release workflow passes `$GITHUB_REF_NAME`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function tagMatchesVersion(tag: string, version: string): boolean {
  return tag.replace(/^refs\/tags\//, '') === `v${version}`;
}

function main(): void {
  const tag = process.argv[2];
  if (!tag) {
    console.error('Usage: check-tag-version <tag>');
    process.exit(1);
  }
  const pkgPath = resolve(fileURLToPath(import.meta.url), '../../package.json');
  const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  if (!tagMatchesVersion(tag, version)) {
    console.error(`Tag ${tag} does not match package.json version ${version}. Bump the version or re-tag.`);
    process.exit(1);
  }
  console.log(`Tag ${tag} matches package.json version ${version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
