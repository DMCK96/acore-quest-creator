import type { SecretBox } from './store/store';

/**
 * Connection passwords, sealed by the operating system.
 *
 * The store keeps an opaque blob; only the platform keychain can turn it back into a password.
 * There is deliberately no fallback: on a machine where Electron cannot reach a keyring, the app
 * refuses to hold the secret at all rather than writing it to disk in the clear.
 */

/** The slice of Electron's `safeStorage` this module needs, so the tests can hand it a double. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Uint8Array;
  decryptString(blob: Uint8Array): string;
}

export class SecretStorageUnavailableError extends Error {
  constructor() {
    super(
      'This system has no secure storage available, so connection passwords cannot be saved. ' +
        'Unlock your keyring (or install one) and restart the app.',
    );
    this.name = 'SecretStorageUnavailableError';
  }
}

export function createSecretBox(safe: SafeStorageLike): SecretBox {
  const available = (): void => {
    if (!safe.isEncryptionAvailable()) throw new SecretStorageUnavailableError();
  };
  return {
    encrypt(plain) {
      available();
      return safe.encryptString(plain);
    },
    decrypt(blob) {
      available();
      return safe.decryptString(blob);
    },
  };
}
