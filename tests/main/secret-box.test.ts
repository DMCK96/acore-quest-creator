import { describe, it, expect } from 'vitest';
import { createSecretBox, SecretStorageUnavailableError } from '../../src/main/secret-box';

const safe = (available: boolean) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Uint8Array.from(Buffer.from(s).reverse()),
  decryptString: (b: Uint8Array) => Buffer.from(b).reverse().toString(),
});

describe('createSecretBox', () => {
  it('round-trips through the platform store', () => {
    const box = createSecretBox(safe(true));
    expect(box.decrypt(box.encrypt('pässwörd'))).toBe('pässwörd');
  });
  it('refuses to store secrets in plaintext when encryption is unavailable', () => {
    const box = createSecretBox(safe(false));
    expect(() => box.encrypt('x')).toThrow(SecretStorageUnavailableError);
    expect(() => box.decrypt(new Uint8Array([1]))).toThrow(SecretStorageUnavailableError);
  });
});
