import { describe, expect, it } from 'vitest';
import { defineThemeSystem } from '../src/core.js';
import {
  formatInspection,
  formatScheduleReport,
  inspect,
  inspectSchedule
} from '../src/inspect.js';
import {
  staticFallbackCss,
  tailwindCss,
  themeInlineCss
} from '../src/tailwind.js';
import { findContrastViolations, isOutOfSrgbGamut } from '../src/testing.js';
import { createFixtureSystem } from './fixture.js';
import dawnToDusk from '../src/presets/dawn-to-dusk.js';
import tidal from '../src/presets/tidal.js';
import contrastFirst from '../src/presets/contrast-first.js';
import paper from '../src/presets/paper.js';

const system = createFixtureSystem();

describe('inspect', () => {
  it('reports the active stop pair and progress mid-interval', () => {
    const inspection = inspect(system, 10 * 60);
    expect(inspection.time).toBe('10:00');
    expect(inspection.previousStop?.phase).toBe('morning');
    expect(inspection.nextStop?.phase).toBe('noon');
    expect(inspection.minutesToNextStop).toBe(120);
    // 540 -> 720, so 600 sits a third of the way through.
    expect(inspection.snapshot.progress).toBeCloseTo(1 / 3, 5);
  });

  it('reports zero progress exactly on a stop, pointing at the next', () => {
    const inspection = inspect(system, 9 * 60);
    expect(inspection.previousStop?.phase).toBe('morning');
    expect(inspection.nextStop?.phase).toBe('noon');
    expect(inspection.snapshot.progress).toBe(0);
    expect(inspection.minutesToNextStop).toBe(180);
  });

  it('advances the stop pair across the wrap at midnight', () => {
    const inspection = inspect(system, 1400);
    expect(inspection.previousStop?.phase).toBe('late-night');
    expect(inspection.nextStop?.phase).toBe('night');
    // 1320 -> 0 crosses midnight, so the distance must wrap rather than go
    // negative.
    expect(inspection.minutesToNextStop).toBe(40);
  });

  it('flags contrast per declared pair at the current minute', () => {
    const inspection = inspect(system, 12 * 60);
    expect(inspection.roles.length).toBe(system.roles.length);
    expect(inspection.failures).toEqual([]);
    for (const role of inspection.roles) {
      expect(role.actual).toBeGreaterThanOrEqual(role.required);
      expect(role.passes).toBe(true);
    }
  });

  it('surfaces failures rather than hiding them', () => {
    const dim = defineThemeSystem({
      staticThemes: {
        light: {
          background: 'oklch(0.97 0.01 250 / 1)',
          foreground: 'oklch(0.3 0.03 250 / 1)'
        },
        dark: {
          background: 'oklch(0.13 0.02 250 / 1)',
          foreground: 'oklch(0.96 0.01 250 / 1)'
        }
      },
      roles: { pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' }] },
      stops: [
        {
          minute: 0,
          appearance: 'light',
          phase: 'a',
          tokens: {
            background: 'oklch(0.6 0.01 250 / 1)',
            foreground: 'oklch(0.5 0.03 250 / 1)'
          }
        }
      ]
    });

    const inspection = inspect(dim, 0);
    expect(inspection.failures.length).toBe(1);
    expect(formatInspection(inspection)).toContain('FAIL');

    const report = inspectSchedule(dim);
    expect(report.failingMinutes).toBe(1440);
    expect(report.windows.length).toBeGreaterThan(0);
    expect(formatScheduleReport(report)).toContain('worst');
  });

  it('formats a passing schedule as a single line', () => {
    const report = inspectSchedule(system);
    expect(report.failingMinutes).toBe(0);
    expect(report.outOfGamutMinutes).toBe(0);
    expect(formatScheduleReport(report)).toMatch(/^PASS/);
  });

  it('renders every token with its css value', () => {
    const text = formatInspection(inspect(system, 600));
    for (const key of system.tokenKeys) {
      expect(text).toContain(key);
    }
    expect(text).toContain('oklch(');
  });
});

describe('tailwind', () => {
  it('maps every token into the colour namespace', () => {
    const css = themeInlineCss(system);
    expect(css).toContain('@theme inline {');
    for (const key of system.tokenKeys) {
      expect(css).toContain(`--color-${key}: var(--tat-${key});`);
    }
  });

  it('honours a bare source prefix', () => {
    expect(themeInlineCss(system, { cssVariablePrefix: null })).toContain(
      '--color-background: var(--background);'
    );
  });

  it('honours a custom namespace and subset', () => {
    const css = themeInlineCss(system, {
      namespace: 'brand',
      include: ['accent']
    });
    expect(css).toContain('--brand-accent: var(--tat-accent);');
    expect(css).not.toContain('background');
  });

  it('rejects unknown token keys', () => {
    expect(() => themeInlineCss(system, { include: ['nope'] })).toThrow(
      /unknown token key/
    );
  });

  it('emits static fallbacks for :root and .dark', () => {
    const css = staticFallbackCss(system);
    expect(css).toContain(':root {');
    expect(css).toContain('.dark {');
    // The controller sets variables at runtime, so without these the page is
    // unstyled until hydration.
    expect(css.match(/--tat-background:/g)?.length).toBe(2);
  });

  it('composes fallbacks before the mapping', () => {
    const css = tailwindCss(system);
    expect(css.indexOf(':root {')).toBeLessThan(css.indexOf('@theme inline'));
  });
});

describe('presets', () => {
  const presets = [
    ['dawn-to-dusk', dawnToDusk, 'AA'],
    ['tidal', tidal, 'AA'],
    ['contrast-first', contrastFirst, 'AAA'],
    ['paper', paper, 'AA']
  ] as const;

  for (const [id, preset, level] of presets) {
    describe(id, () => {
      it(`certifies at ${level} across all 1,440 minutes`, () => {
        expect(findContrastViolations(preset)).toEqual([]);
        for (const role of preset.roles) {
          expect(role.min).toBe(level);
        }
      });

      it('stays inside the sRGB gamut all day', () => {
        const report = inspectSchedule(preset);
        expect(report.outOfGamutMinutes).toBe(0);
      });

      it('declares roles and snaps its appearance swaps', () => {
        // defineThemeSystem throws on an observable swap, so importing the
        // preset at all is most of the assertion.
        expect(preset.roles.length).toBe(3);
        expect(preset.stops.length).toBeGreaterThanOrEqual(6);
      });

      it('exposes both static fallbacks in gamut', () => {
        for (const variant of ['light', 'dark'] as const) {
          for (const color of Object.values(preset.staticThemes[variant])) {
            expect(isOutOfSrgbGamut(color)).toBe(false);
          }
        }
      });
    });
  }

  it('keeps paper achromatic on its surfaces', () => {
    for (const stop of paper.stops) {
      for (const key of ['background', 'surface'] as const) {
        expect(stop.tokens[key]?.c).toBeLessThanOrEqual(0.02);
      }
    }
    // The accent is the one chromatic token, which is the whole point.
    expect(
      paper.stops.some((stop) => (stop.tokens.accent?.c ?? 0) > 0.05)
    ).toBe(true);
  });

  it('keeps tidal clear of warm hues', () => {
    for (const stop of tidal.stops) {
      const hue = stop.tokens.accent?.h ?? 0;
      expect(hue).toBeGreaterThan(150);
      expect(hue).toBeLessThan(300);
    }
  });
});
