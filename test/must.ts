/**
 * Narrows an optional to a value, failing the test if it is not there.
 *
 * Tests here index into arrays and `find()` results constantly, and both hand
 * back `T | undefined`. A non-null assertion silences that but reports the
 * absence as `Cannot read properties of undefined` several lines later; this
 * reports it where it happened and says what was missing.
 */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${what} to be present.`);
  }
  return value;
}
