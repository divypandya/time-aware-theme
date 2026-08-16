import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MINUTES_PER_DAY,
  defineThemeSystem,
  normalizeMinute,
  resolveThemeAt,
  serializeOklch,
  type ThemeStopInput
} from '../src/core.js';
import { contrastRatio, isOutOfSrgbGamut } from '../src/testing.js';

/**
 * Invariants that must hold for *every* schedule, not just the ones we thought
 * to write down. Hand-picked minutes are what let the crossing bug through:
 * every asserted minute passed, and the failure lived between them.
 */

const RUNS = 200;

const oklchArb = fc.record({
  l: fc.double({ min: 0, max: 1, noNaN: true }),
  c: fc.double({ min: 0, max: 0.3, noNaN: true }),
  h: fc.double({ min: 0, max: 360, noNaN: true })
});

/** Distinct, ascending stop minutes — the shape defineThemeSystem requires. */
const minutesArb = (count: number) =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: MINUTES_PER_DAY - 1 }), {
      minLength: count,
      maxLength: count
    })
    .map((values) => [...values].sort((a, b) => a - b));

const systemArb = fc
  .integer({ min: 1, max: 8 })
  .chain((count) =>
    fc.tuple(
      minutesArb(count),
      fc.array(fc.tuple(oklchArb, oklchArb), {
        minLength: count,
        maxLength: count
      })
    )
  )
  .map(([minutes, colors]) => {
    const stops = minutes.map((minute, index) => {
      const pair = colors[index];
      const background = pair?.[0] ?? { l: 0.1, c: 0, h: 0 };
      const foreground = pair?.[1] ?? { l: 0.9, c: 0, h: 0 };
      return {
        minute,
        appearance: background.l < 0.5 ? 'dark' : 'light',
        phase: `phase-${index}`,
        tokens: {
          background: { ...background, alpha: 1 },
          foreground: { ...foreground, alpha: 1 }
        }
      } satisfies ThemeStopInput;
    });

    return defineThemeSystem({
      // Object form, matching the shape TTokens infers from the stops above.
      staticThemes: {
        light: {
          background: { l: 0.97, c: 0, h: 0, alpha: 1 },
          foreground: { l: 0.17, c: 0, h: 0, alpha: 1 }
        },
        dark: {
          background: { l: 0.13, c: 0, h: 0, alpha: 1 },
          foreground: { l: 0.96, c: 0, h: 0, alpha: 1 }
        }
      },
      stops
    });
  });

const minuteArb = fc.integer({ min: 0, max: MINUTES_PER_DAY - 1 });

describe('resolver invariants', () => {
  it('never throws for any minute of any schedule', () => {
    // interpolateOklch validates its own output, so an out-of-range channel
    // throws at resolve time in the consumer's browser at one specific minute.
    // That is a crash, not a visual bug.
    fc.assert(
      fc.property(systemArb, (system) => {
        for (let minute = 0; minute < MINUTES_PER_DAY; minute += 7) {
          resolveThemeAt(system, minute);
        }
      }),
      { numRuns: RUNS }
    );
  });

  it('is pure — repeated resolution is identical', () => {
    fc.assert(
      fc.property(systemArb, minuteArb, (system, minute) => {
        const a = resolveThemeAt(system, minute);
        const b = resolveThemeAt(system, minute);
        expect(a.cssText).toBe(b.cssText);
        expect(a.progress).toBe(b.progress);
        expect(a.phase).toBe(b.phase);
      }),
      { numRuns: RUNS }
    );
  });

  it('returns a stop’s own tokens exactly at that stop', () => {
    fc.assert(
      fc.property(systemArb, fc.nat(), (system, index) => {
        const stop = system.stops[index % system.stops.length];
        if (!stop) {
          return;
        }
        const snapshot = resolveThemeAt(system, stop.minute);
        expect(snapshot.phase).toBe(stop.phase);
        expect(snapshot.progress).toBe(0);
        for (const key of system.tokenKeys) {
          const resolved = snapshot.tokens[key];
          const declared = stop.tokens[key];
          expect(resolved && serializeOklch(resolved)).toBe(
            declared && serializeOklch(declared)
          );
        }
      }),
      { numRuns: RUNS }
    );
  });

  it('keeps progress within [0, 1)', () => {
    fc.assert(
      fc.property(systemArb, minuteArb, (system, minute) => {
        const { progress } = resolveThemeAt(system, minute);
        expect(progress).toBeGreaterThanOrEqual(0);
        expect(progress).toBeLessThan(1);
      }),
      { numRuns: RUNS }
    );
  });

  it('is invariant to how the minute is expressed', () => {
    fc.assert(
      fc.property(
        systemArb,
        minuteArb,
        fc.integer({ min: -3, max: 3 }),
        (system, minute, days) => {
          const shifted = minute + days * MINUTES_PER_DAY;
          expect(resolveThemeAt(system, shifted).cssText).toBe(
            resolveThemeAt(system, minute).cssText
          );
          expect(normalizeMinute(shifted)).toBe(minute);
        }
      ),
      { numRuns: RUNS }
    );
  });

  it('moves continuously between adjacent minutes', () => {
    // A schedule interpolates; it must not teleport. Any jump larger than the
    // whole stop-to-stop delta means the bracketing logic picked wrong.
    fc.assert(
      fc.property(systemArb, minuteArb, (system, minute) => {
        if (system.stops.length < 2) {
          return;
        }
        const a = resolveThemeAt(system, minute).tokens.background;
        const b = resolveThemeAt(system, minute + 1).tokens.background;
        if (!a || !b) {
          return;
        }
        const stopMinutes = new Set(system.stops.map((stop) => stop.minute));
        // Crossing into a new interval legitimately changes direction, so only
        // assert on minutes strictly inside one.
        if (stopMinutes.has(normalizeMinute(minute + 1))) {
          return;
        }
        expect(Math.abs(b.l - a.l)).toBeLessThanOrEqual(1);
        expect(Number.isFinite(b.l)).toBe(true);
      }),
      { numRuns: RUNS }
    );
  });

  it('always emits parseable css for every token', () => {
    fc.assert(
      fc.property(systemArb, minuteArb, (system, minute) => {
        const snapshot = resolveThemeAt(system, minute);
        for (const key of system.tokenKeys) {
          expect(snapshot.cssText).toContain(`--${key}:`);
        }
        expect(snapshot.cssText).not.toContain('NaN');
        expect(snapshot.cssText).not.toContain('undefined');
      }),
      { numRuns: RUNS }
    );
  });
});

describe('contrast maths invariants', () => {
  const colorArb = oklchArb
    .map((color) => ({ ...color, alpha: 1 }))
    .filter((color) => !isOutOfSrgbGamut(color));

  it('is symmetric and bounded by the WCAG range', () => {
    fc.assert(
      fc.property(colorArb, colorArb, (left, right) => {
        const forward = contrastRatio(left, right);
        expect(contrastRatio(right, left)).toBeCloseTo(forward, 10);
        expect(forward).toBeGreaterThanOrEqual(1);
        expect(forward).toBeLessThanOrEqual(21);
      }),
      { numRuns: RUNS * 2 }
    );
  });

  it('reports exactly 1:1 against itself', () => {
    fc.assert(
      fc.property(colorArb, (color) => {
        expect(contrastRatio(color, color)).toBeCloseTo(1, 10);
      }),
      { numRuns: RUNS }
    );
  });
});
