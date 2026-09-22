import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest's `globals` mode is off, so @testing-library/react's automatic cleanup (which relies on
// a global `afterEach`) never registers; do it explicitly so DOM from one test never leaks into
// the next.
afterEach(() => {
  cleanup();
});
