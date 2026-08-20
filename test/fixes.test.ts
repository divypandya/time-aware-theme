import { describe, expect, it } from 'vitest';
import { must } from './must.js';
import { defineThemeSystem, type ThemeRolePair } from '../src/core.js';
import {
  assertContrast,
  assertRenderedPath,
  contrastRatio,
  findContrastViolations,
  findRenderedPathViolations
} from '../src/testing.js';

const staticThemes = {
  light: {
    background: 'oklch(0.97 0.01 90 / 1)',
    foreground: 'oklch(0.3 0.02 90 / 1)',
    caption: 'oklch(0.45 0.02 90 / 1)'
  },
  dark: {
    background: 'oklch(0.15 0.03 265 / 1)',
    foreground: 'oklch(0.95 0.02 265 / 1)',
    caption: 'oklch(0.8 0.02 265 / 1)'
  }
};

/** Two mid-greys: illegible, and genuinely ambiguous about which should move. */
const murky = {
  background: 'oklch(0.6 0.02 90 / 1)',
  foreground: 'oklch(0.5 0.02 90 / 1)',
  caption: 'oklch(0.52 0.02 90 / 1)'
};

function murkySystem(roles: { pairs: readonly ThemeRolePair[] }) {
  return defineThemeSystem({
    staticThemes,
    roles,
    stops: [
      { minute: 0, appearance: 'light', phase: 'a', tokens: murky },
      { minute: 720, appearance: 'light', phase: 'b', tokens: murky }
    ]
  });
}

const onePair = {
  pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' as const }]
};

describe('fix hints', () => {
  it('names a direction and a lightness that actually clears the bar', () => {
    const [violation] = findContrastViolations(murkySystem(onePair));
    const best = must(must(violation, 'violation').fixes[0], 'fix');
    expect(best.reachable).toBe(true);

    // The suggestion is only worth anything if applying it works, so apply it.
    const moved =
      best.side === 'fg'
        ? { ...murky, foreground: `oklch(${best.to} 0.02 90 / 1)` }
        : { ...murky, background: `oklch(${best.to} 0.02 90 / 1)` };
    const fixed = defineThemeSystem({
      staticThemes,
      roles: onePair,
      stops: [
        { minute: 0, appearance: 'light', phase: 'a', tokens: moved },
        { minute: 720, appearance: 'light', phase: 'b', tokens: moved }
      ]
    });
    expect(findContrastViolations(fixed)).toEqual([]);
  });

  it('offers the smallest move first and puts dead ends last', () => {
    const [violation] = findContrastViolations(murkySystem(onePair));
    const fixes = must(violation, 'violation').fixes;
    expect(fixes).toHaveLength(4);
    expect(fixes.map((fix) => fix.token)).toContain('background');
    expect(fixes.map((fix) => fix.token)).toContain('foreground');

    const reachable = fixes.filter((fix) => fix.reachable);
    const dead = fixes.filter((fix) => !fix.reachable);
    expect(reachable.length).toBeGreaterThan(0);
    expect(fixes.slice(0, reachable.length)).toEqual(reachable);
    for (const fix of dead) {
      // A dead end reports the end of its range, not a lightness that works.
      expect([0, 1]).toContain(fix.to);
    }
    for (let index = 1; index < reachable.length; index += 1) {
      expect(must(reachable[index], 'fix').delta).toBeGreaterThanOrEqual(
        must(reachable[index - 1], 'fix').delta
      );
    }
  });

  it('warns when the token it suggests moving is shared', () => {
    const shared = murkySystem({
      pairs: [
        { bg: 'background', fg: 'foreground', min: 'AA' },
        { bg: 'background', fg: 'caption', min: 'AA' }
      ]
    });
    const violation = findContrastViolations(shared).find(
      (entry) => entry.fg === 'foreground'
    );
    const backgroundFix = must(violation, 'violation').fixes.find(
      (fix) => fix.token === 'background'
    );
    expect(must(backgroundFix, 'background fix').alsoUsedBy).toEqual([
      'caption on background'
    ]);

    // And the foreground, used by nothing else, is flagged as safe to move.
    const foregroundFix = must(violation, 'violation').fixes.find(
      (fix) => fix.token === 'foreground'
    );
    expect(must(foregroundFix, 'foreground fix').alsoUsedBy).toEqual([]);
  });

  it('marks a direction unreachable rather than suggesting a lie', () => {
    // Lightening text that is already lighter than its background cannot
    // reach AA here: white on this grey tops out around 3.2:1.
    const [violation] = findContrastViolations(murkySystem(onePair));
    const wrongWay = must(violation, 'violation').fixes.find(
      (fix) => fix.token === 'foreground' && fix.direction === 'lighter'
    );
    expect(must(wrongWay, 'lighter fix').reachable).toBe(false);
    expect(
      contrastRatio(
        { l: 0.6, c: 0.02, h: 90, alpha: 1 },
        { l: 1, c: 0, h: null, alpha: 1 }
      )
    ).toBeLessThan(4.5);
  });

  it('accounts for chroma the gamut will not hold', () => {
    // A suggestion at L=0.95 with 0.3 chroma is not a colour; clamping means
    // the reported lightness is one that renders as promised.
    const vivid = {
      background: 'oklch(0.6 0.3 145 / 1)',
      foreground: 'oklch(0.55 0.3 145 / 1)',
      caption: 'oklch(0.55 0.3 145 / 1)'
    };
    const system = defineThemeSystem({
      staticThemes,
      roles: onePair,
      stops: [
        { minute: 0, appearance: 'light', phase: 'a', tokens: vivid },
        { minute: 720, appearance: 'light', phase: 'b', tokens: vivid }
      ]
    });
    const best = must(
      must(findContrastViolations(system)[0], 'violation').fixes[0],
      'fix'
    );
    expect(best.reachable).toBe(true);
    expect(best.to).toBeGreaterThanOrEqual(0);
    expect(best.to).toBeLessThanOrEqual(1);
  });

  it('puts the cheapest fix in the thrown message', () => {
    expect(() => {
      assertContrast(murkySystem(onePair));
    }).toThrow(/Smallest fix: "\w+" (lighter|darker), L 0\.\d+ -> 0\.\d+/);
  });

  it('says so plainly when no single token can fix it', () => {
    // Two colours a hair apart at mid-lightness: neither can reach AAA alone.
    const hopeless = {
      background: 'oklch(0.55 0.02 90 / 1)',
      foreground: 'oklch(0.54 0.02 90 / 1)',
      caption: 'oklch(0.54 0.02 90 / 1)'
    };
    const system = defineThemeSystem({
      staticThemes,
      roles: { pairs: [{ bg: 'background', fg: 'foreground', min: 'AAA' }] },
      stops: [
        { minute: 0, appearance: 'light', phase: 'a', tokens: hopeless },
        { minute: 720, appearance: 'light', phase: 'b', tokens: hopeless }
      ]
    });
    expect(() => {
      assertContrast(system);
    }).toThrow(/No single token clears it/);
  });

  it('carries fixes on rendered-path violations too', () => {
    const night = {
      background: 'oklch(0.46 0.03 265 / 1)',
      foreground: 'oklch(0.86 0.015 265 / 1)',
      caption: 'oklch(0.86 0.015 265 / 1)'
    };
    const system = defineThemeSystem({
      staticThemes,
      roles: onePair,
      stops: [
        { minute: 0, appearance: 'dark', phase: 'night', tokens: night },
        {
          minute: 600,
          appearance: 'dark',
          phase: 'night',
          tokens: staticThemes.dark
        }
      ]
    });
    const violations = findRenderedPathViolations(system, { level: 'AAA' });
    expect(violations.length).toBeGreaterThan(0);
    expect(must(violations[0], 'violation').fixes.length).toBeGreaterThan(0);
    expect(() => {
      assertRenderedPath(system, { level: 'AAA' });
    }).toThrow(/Smallest fix|No single token/);
  });
});
