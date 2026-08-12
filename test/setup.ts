import { afterEach } from 'vitest';

// React 18/19 use this flag to decide whether `act()` should flush updates.
// Vitest/jsdom does not set it automatically.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
