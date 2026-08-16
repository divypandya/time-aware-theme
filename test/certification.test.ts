import { describe, expect, it } from 'vitest';
import { resolveThemeAt } from '../src/core.js';
import {
  assertContrast,
  findContrastViolations,
  isOutOfSrgbGamut,
  sampleSchedule
} from '../src/testing.js';
import { createFixtureSystem } from './fixture.js';

/**
 * The fixture is the schedule consumers copy from. Before v0.2 it failed WCAG
 * AA on 166 of 1,440 minutes — worst 1.003:1 at 16:33, a lightness delta of
 * 0.0002, which is invisible text — while CI reported success, because the
 * sweep only ever warned. These assertions are the regression guard.
 */
describe('fixture certification', () => {
  const system = createFixtureSystem();

  it('meets every declared role contract at every minute', () => {
    expect(findContrastViolations(system)).toEqual([]);
    expect(() => {
      assertContrast(system);
    }).not.toThrow();
  });

  it('never leaves the sRGB gamut', () => {
    const outOfGamut = sampleSchedule(system).flatMap((snapshot) =>
      Object.entries(snapshot.tokens)
        .filter(([, color]) => isOutOfSrgbGamut(color))
        .map(([key]) => `${key}@${snapshot.minute}`)
    );
    expect(outOfGamut).toEqual([]);
  });

  it('resolves every minute of the day without throwing', () => {
    // interpolateOklch validates its own output, so an out-of-range channel
    // throws at resolve time in the consumer's browser rather than at build.
    expect(() => {
      for (let minute = 0; minute < 1440; minute += 1) {
        resolveThemeAt(system, minute);
      }
    }).not.toThrow();
  });

  it('certifies its static fallbacks too', () => {
    // Reachable via setMode() and never visited by the time-aware sweep.
    for (const variant of ['light', 'dark'] as const) {
      for (const color of Object.values(system.staticThemes[variant])) {
        expect(isOutOfSrgbGamut(color)).toBe(false);
      }
    }
  });

  it('has no observable role swap left in it', () => {
    // defineThemeSystem would have thrown at import time, so reaching this
    // point is the assertion; the explicit check documents the intent.
    expect(system.roles.length).toBeGreaterThan(0);
    expect(system.stops.length).toBeGreaterThan(0);
  });
});
