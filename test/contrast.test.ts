import { describe, expect, it } from 'vitest';
import { defineThemeSystem, holdThenSnap } from '../src/core.js';
import {
  assertContrast,
  contrastRatio,
  contrastThreshold,
  findContrastViolations,
  isOutOfSrgbGamut,
  meetsWcagAA,
  relativeLuminance,
  sampleSchedule
} from '../src/testing.js';

const WHITE = { l: 1, c: 0, h: null, alpha: 1 } as const;
const BLACK = { l: 0, c: 0, h: null, alpha: 1 } as const;

const roles = {
  pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' as const }]
};

function system(stops: Parameters<typeof defineThemeSystem>[0]['stops']) {
  return defineThemeSystem({
    staticThemes: {
      light: {
        background: 'oklch(0.97 0.01 250 / 1)',
        foreground: 'oklch(0.17 0.03 250 / 1)'
      },
      dark: {
        background: 'oklch(0.13 0.02 250 / 1)',
        foreground: 'oklch(0.96 0.01 250 / 1)'
      }
    },
    roles,
    stops
  });
}

describe('colour maths', () => {
  it('matches the WCAG reference points', () => {
    // Pure black on pure white is the definitional 21:1 maximum.
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
  });

  it('is order independent', () => {
    const a = { l: 0.4, c: 0.1, h: 250, alpha: 1 };
    const b = { l: 0.9, c: 0.05, h: 90, alpha: 1 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
  });

  it('maps levels to WCAG thresholds', () => {
    expect(contrastThreshold('AAA')).toBe(7);
    expect(contrastThreshold('AA')).toBe(4.5);
    // Large text and non-text share 3:1 but are distinct levels, because
    // holding a border to 4.5:1 would force borders that read as rules.
    expect(contrastThreshold('AA-large')).toBe(3);
    expect(contrastThreshold('non-text')).toBe(3);
  });

  it('detects out-of-gamut colours', () => {
    // sRGB has no dark yellows: chroma 0.14 at L=0.5, hue 90 is unreachable.
    expect(isOutOfSrgbGamut({ l: 0.5, c: 0.14, h: 90, alpha: 1 })).toBe(true);
    expect(isOutOfSrgbGamut({ l: 0.5, c: 0.09, h: 90, alpha: 1 })).toBe(false);
    expect(isOutOfSrgbGamut(WHITE)).toBe(false);
    expect(isOutOfSrgbGamut(BLACK)).toBe(false);
  });

  it('handles achromatic colours with a null hue', () => {
    const grey = { l: 0.5, c: 0, h: null, alpha: 1 };
    // OKLCH lightness is perceptual, not linear: L=0.5 is linear luminance
    // 0.125, so mid-grey reaches only 3.5:1 against black — below AA. This is
    // the trap in "surely 50% grey is readable on black".
    expect(relativeLuminance(grey)).toBeCloseTo(0.125, 4);
    expect(contrastRatio(grey, BLACK)).toBeCloseTo(3.5, 3);
    expect(meetsWcagAA(grey, BLACK)).toBe(false);

    // A null hue must not poison the maths via NaN.
    expect(Number.isFinite(contrastRatio(grey, WHITE))).toBe(true);
  });
});

describe('sampleSchedule', () => {
  it('samples every integer minute by default', () => {
    const samples = sampleSchedule(
      system([
        {
          minute: 0,
          appearance: 'dark',
          phase: 'night',
          tokens: {
            background: 'oklch(0.14 0.02 260 / 1)',
            foreground: 'oklch(0.96 0.01 260 / 1)'
          }
        },
        {
          minute: 720,
          appearance: 'dark',
          phase: 'day',
          tokens: {
            background: 'oklch(0.20 0.02 260 / 1)',
            foreground: 'oklch(0.94 0.01 260 / 1)'
          }
        }
      ])
    );
    expect(samples).toHaveLength(1440);
    expect(samples[0]?.minute).toBe(0);
    expect(samples[1439]?.minute).toBe(1439);
  });

  it('honours a coarser step', () => {
    const samples = sampleSchedule(
      system([
        {
          minute: 0,
          appearance: 'dark',
          phase: 'night',
          tokens: {
            background: 'oklch(0.14 0.02 260 / 1)',
            foreground: 'oklch(0.96 0.01 260 / 1)'
          }
        }
      ]),
      { stepMinutes: 60 }
    );
    expect(samples).toHaveLength(24);
  });
});

describe('contrast violations', () => {
  it('requires roles to be declared', () => {
    const withoutRoles = defineThemeSystem({
      staticThemes: {
        light: { background: 'oklch(0.97 0 none / 1)' },
        dark: { background: 'oklch(0.13 0 none / 1)' }
      },
      stops: [
        {
          minute: 0,
          appearance: 'dark',
          phase: 'night',
          tokens: { background: 'oklch(0.13 0 none / 1)' }
        }
      ]
    });
    expect(() => findContrastViolations(withoutRoles)).toThrow(/declare roles/);
  });

  it('passes a schedule that snaps through its role swap', () => {
    const snapped = system([
      {
        minute: 0,
        appearance: 'dark',
        phase: 'night',
        tokens: {
          background: 'oklch(0.14 0.02 260 / 1)',
          foreground: 'oklch(0.96 0.01 260 / 1)'
        }
      },
      ...holdThenSnap({
        at: 360,
        from: {
          background: 'oklch(0.14 0.02 260 / 1)',
          foreground: 'oklch(0.96 0.01 260 / 1)'
        },
        to: {
          background: 'oklch(0.97 0.01 75 / 1)',
          foreground: 'oklch(0.25 0.05 55 / 1)'
        },
        fromAppearance: 'dark',
        toAppearance: 'light',
        phase: 'night',
        nextPhase: 'day'
      }),
      // The day must snap back to night too: the final stop wraps around to
      // minute 0, and that wrap is an interpolated interval like any other.
      ...holdThenSnap({
        at: 1080,
        from: {
          background: 'oklch(0.97 0.01 75 / 1)',
          foreground: 'oklch(0.25 0.05 55 / 1)'
        },
        to: {
          background: 'oklch(0.14 0.02 260 / 1)',
          foreground: 'oklch(0.96 0.01 260 / 1)'
        },
        fromAppearance: 'light',
        toAppearance: 'dark',
        phase: 'day',
        nextPhase: 'night'
      })
    ]);

    expect(findContrastViolations(snapped)).toEqual([]);
    expect(() => {
      assertContrast(snapped);
    }).not.toThrow();
  });

  it('reports the failing minute, pair and interval', () => {
    // Both stops are individually legible but too close together to reach AA
    // in between — a contrast failure that is not a role swap.
    const dim = system([
      {
        minute: 0,
        appearance: 'light',
        phase: 'a',
        tokens: {
          background: 'oklch(0.97 0.01 250 / 1)',
          foreground: 'oklch(0.30 0.03 250 / 1)'
        }
      },
      {
        minute: 720,
        appearance: 'light',
        phase: 'b',
        tokens: {
          background: 'oklch(0.60 0.01 250 / 1)',
          foreground: 'oklch(0.40 0.03 250 / 1)'
        }
      }
    ]);

    const violations = findContrastViolations(dim);
    expect(violations.length).toBeGreaterThan(0);

    const first = violations[0];
    expect(first?.bg).toBe('background');
    expect(first?.fg).toBe('foreground');
    expect(first?.level).toBe('AA');
    expect(first?.required).toBe(4.5);
    expect(first?.actual).toBeLessThan(4.5);

    expect(() => {
      assertContrast(dim);
    }).toThrow(/Worst: \d+\.\d+:1 at \d\d:\d\d/);
    expect(() => {
      assertContrast(dim);
    }).toThrow(/holdThenSnap/);
  });

  it('honours an overriding level', () => {
    const modest = system([
      {
        minute: 0,
        appearance: 'light',
        phase: 'a',
        tokens: {
          background: 'oklch(0.97 0.01 250 / 1)',
          foreground: 'oklch(0.50 0.03 250 / 1)'
        }
      }
    ]);
    // Comfortably above 3:1, comfortably below 7:1.
    expect(findContrastViolations(modest, { level: 'AA-large' })).toEqual([]);
    expect(
      findContrastViolations(modest, { level: 'AAA' }).length
    ).toBeGreaterThan(0);
  });
});
