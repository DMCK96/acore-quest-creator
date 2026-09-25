import { describe, expect, it } from 'vitest';
import { tagMatchesVersion } from '../../scripts/check-tag-version';

describe('tagMatchesVersion', () => {
  it('accepts v followed by the exact package version', () => {
    expect(tagMatchesVersion('v0.2.0', '0.2.0')).toBe(true);
  });

  it('accepts pre-release versions', () => {
    expect(tagMatchesVersion('v0.2.0-rc.1', '0.2.0-rc.1')).toBe(true);
  });

  it('accepts a full git ref', () => {
    expect(tagMatchesVersion('refs/tags/v0.2.0', '0.2.0')).toBe(true);
  });

  it('rejects a tag for a different version', () => {
    expect(tagMatchesVersion('v0.2.1', '0.2.0')).toBe(false);
  });

  it('rejects a tag that is only a prefix of the version', () => {
    expect(tagMatchesVersion('v0.2', '0.2.0')).toBe(false);
  });

  it('rejects a tag without the v prefix', () => {
    expect(tagMatchesVersion('0.2.0', '0.2.0')).toBe(false);
  });

  it('rejects a pre-release tag when the package is the plain version', () => {
    expect(tagMatchesVersion('v0.2.0-rc.1', '0.2.0')).toBe(false);
  });
});
