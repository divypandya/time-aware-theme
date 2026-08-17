import { describe, expect, it, vi } from 'vitest';
import {
  defineThemeSystem,
  holdThenSnap,
  resolveThemeAt,
  resolveThemeSnapshot
} from '../src/core.js';

function twoStopSystem() {
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
    stops: [
      {
        minute: 0,
        appearance: 'dark',
        phase: 'night',
        tokens: {
          background: 'oklch(0.20 0.02 260 / 1)',
          foreground: 'oklch(0.90 0.01 260 / 1)'
        }
      },
      {
        minute: 600,
        appearance: 'light',
        phase: 'day',
        tokens: {
          background: 'oklch(0.40 0.02 260 / 1)',
          foreground: 'oklch(0.70 0.01 260 / 1)'
        }
      }
    ]
  });
}

describe('progress, nextPhase, nextAppearance', () => {
  it('is zero at an exact stop and points at the following stop', () => {
    const snapshot = resolveThemeAt(twoStopSystem(), 0);
    expect(snapshot.progress).toBe(0);
    expect(snapshot.phase).toBe('night');
    // At a stop we sit at the start of the interval that stop opens, so the
    // next stop is the following one — not this one.
    expect(snapshot.nextPhase).toBe('day');
    expect(snapshot.nextAppearance).toBe('light');
  });

  it('rises monotonically across an interval', () => {
    const system = twoStopSystem();
    let previous = -1;
    for (let minute = 0; minute < 600; minute += 1) {
      const { progress } = resolveThemeAt(system, minute);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThan(1);
      expect(progress).toBeGreaterThan(previous);
      previous = progress;
    }
    expect(resolveThemeAt(system, 300).progress).toBeCloseTo(0.5, 6);
  });

  it('resets to zero as it crosses into the next interval', () => {
    const system = twoStopSystem();
    expect(resolveThemeAt(system, 599).progress).toBeGreaterThan(0.99);
    expect(resolveThemeAt(system, 600).progress).toBe(0);
    expect(resolveThemeAt(system, 600).phase).toBe('day');
  });

  it('wraps from the final stop back to the first', () => {
    const system = twoStopSystem();
    // The interval from the last stop runs through midnight to stop zero.
    const late = resolveThemeAt(system, 1200);
    expect(late.phase).toBe('day');
    expect(late.nextPhase).toBe('night');
    expect(late.nextAppearance).toBe('dark');

    const atLast = resolveThemeAt(system, 600);
    expect(atLast.nextPhase).toBe('night');
    expect(atLast.nextAppearance).toBe('dark');
  });

  it('is inert for a single-stop system', () => {
    const single = defineThemeSystem({
      staticThemes: {
        light: { background: 'oklch(0.97 0 none / 1)' },
        dark: { background: 'oklch(0.13 0 none / 1)' }
      },
      stops: [
        {
          minute: 0,
          appearance: 'dark',
          phase: 'always',
          tokens: { background: 'oklch(0.13 0 none / 1)' }
        }
      ]
    });
    const snapshot = resolveThemeAt(single, 725);
    expect(snapshot.progress).toBe(0);
    expect(snapshot.nextPhase).toBe('always');
    expect(snapshot.nextAppearance).toBe('dark');
  });

  it('is inert in static modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const snapshot = resolveThemeSnapshot(twoStopSystem(), mode, 400);
      expect(snapshot.progress).toBe(0);
      expect(snapshot.phase).toBe('static');
      expect(snapshot.nextPhase).toBe('static');
      expect(snapshot.nextAppearance).toBe(mode);
    }
  });
});

describe('achromatic hue interpolation', () => {
  function fadeSystem(from: string, to: string) {
    return defineThemeSystem({
      staticThemes: {
        light: { background: 'oklch(0.97 0 none / 1)' },
        dark: { background: 'oklch(0.13 0 none / 1)' }
      },
      stops: [
        {
          minute: 0,
          appearance: 'dark',
          phase: 'a',
          tokens: { background: from }
        },
        {
          minute: 600,
          appearance: 'dark',
          phase: 'b',
          tokens: { background: to }
        }
      ]
    });
  }

  it('borrows the hue from whichever endpoint has chroma', () => {
    // Documented behaviour (feedback #12): a c=0 endpoint has no hue to
    // contribute, so the chromatic endpoint's hue is used throughout.
    const greyToBlue = fadeSystem(
      'oklch(0.5 0 none / 1)',
      'oklch(0.5 0.1 250 / 1)'
    );
    expect(resolveThemeAt(greyToBlue, 300).tokens.background?.h).toBeCloseTo(
      250,
      5
    );

    const blueToGrey = fadeSystem(
      'oklch(0.5 0.1 250 / 1)',
      'oklch(0.5 0 none / 1)'
    );
    expect(resolveThemeAt(blueToGrey, 300).tokens.background?.h).toBeCloseTo(
      250,
      5
    );
  });

  it('stays achromatic when both endpoints are grey', () => {
    const greyToGrey = fadeSystem(
      'oklch(0.2 0 none / 1)',
      'oklch(0.8 0 none / 1)'
    );
    const mid = resolveThemeAt(greyToGrey, 300).tokens.background;
    expect(mid?.c).toBe(0);
    expect(mid?.h).toBeNull();
    expect(mid?.l).toBeCloseTo(0.5, 5);
  });

  it('takes the shortest path around the hue circle', () => {
    // 350deg to 10deg should cross 0deg, not travel backwards through 180deg.
    const wrap = fadeSystem('oklch(0.5 0.1 350 / 1)', 'oklch(0.5 0.1 10 / 1)');
    expect(resolveThemeAt(wrap, 300).tokens.background?.h).toBeCloseTo(0, 4);
  });
});

describe('role swap lint', () => {
  const roles = {
    pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' as const }]
  };
  const staticThemes = {
    light: {
      background: 'oklch(0.97 0.01 250 / 1)',
      foreground: 'oklch(0.17 0.03 250 / 1)'
    },
    dark: {
      background: 'oklch(0.13 0.02 250 / 1)',
      foreground: 'oklch(0.96 0.01 250 / 1)'
    }
  };

  const darkTokens = {
    background: 'oklch(0.14 0.02 260 / 1)',
    foreground: 'oklch(0.96 0.01 260 / 1)'
  };
  const lightTokens = {
    background: 'oklch(0.97 0.01 75 / 1)',
    foreground: 'oklch(0.25 0.05 55 / 1)'
  };

  it('rejects an observable swap and names the offending stops', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes,
        roles,
        stops: [
          {
            minute: 180,
            appearance: 'dark',
            phase: 'pre-dawn',
            tokens: darkTokens
          },
          {
            minute: 360,
            appearance: 'light',
            phase: 'dawn',
            tokens: lightTokens
          }
        ]
      })
    ).toThrow(/swaps sides between minute 180 \(pre-dawn\) and 360 \(dawn\)/);
  });

  it('permits a swap that occupies a single minute', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes,
        roles,
        stops: [
          ...holdThenSnap({
            at: 360,
            from: darkTokens,
            to: lightTokens,
            fromAppearance: 'dark',
            toAppearance: 'light',
            phase: 'night',
            nextPhase: 'day'
          }),
          ...holdThenSnap({
            at: 1080,
            from: lightTokens,
            to: darkTokens,
            fromAppearance: 'light',
            toAppearance: 'dark',
            phase: 'day',
            nextPhase: 'night'
          })
        ]
      })
    ).not.toThrow();
  });

  it('checks the wrap-around interval too', () => {
    // Legal going forwards, but the last stop wraps back to a swapped first.
    expect(() =>
      defineThemeSystem({
        staticThemes,
        roles,
        stops: [
          { minute: 0, appearance: 'dark', phase: 'night', tokens: darkTokens },
          ...holdThenSnap({
            at: 360,
            from: darkTokens,
            to: lightTokens,
            fromAppearance: 'dark',
            toAppearance: 'light',
            phase: 'night',
            nextPhase: 'day'
          })
        ]
      })
    ).toThrow(/swaps sides between minute 361 \(day\) and 0 \(night\)/);
  });

  it('does nothing when no roles are declared', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes,
        stops: [
          {
            minute: 180,
            appearance: 'dark',
            phase: 'pre-dawn',
            tokens: darkTokens
          },
          {
            minute: 360,
            appearance: 'light',
            phase: 'dawn',
            tokens: lightTokens
          }
        ]
      })
    ).not.toThrow();
  });

  it('validates that role keys reference real tokens', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes,
        roles: { pairs: [{ bg: 'background', fg: 'nope' }] },
        stops: [
          { minute: 0, appearance: 'dark', phase: 'night', tokens: darkTokens }
        ]
      })
    ).toThrow(/must reference a declared token key/);
  });
});

describe('degenerate schedule warning', () => {
  const staticThemes = {
    light: { background: 'oklch(0.97 0 none / 1)' },
    dark: { background: 'oklch(0.13 0 none / 1)' }
  };
  const a = { background: 'oklch(0.20 0 none / 1)' };
  const b = { background: 'oklch(0.80 0 none / 1)' };

  it('warns when stops revisit the same few palettes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    defineThemeSystem({
      name: 'degenerate',
      staticThemes,
      stops: [
        { minute: 0, appearance: 'dark', phase: 'p1', tokens: a },
        { minute: 300, appearance: 'light', phase: 'p2', tokens: b },
        { minute: 600, appearance: 'dark', phase: 'p3', tokens: a },
        { minute: 900, appearance: 'light', phase: 'p4', tokens: b },
        { minute: 1200, appearance: 'dark', phase: 'p5', tokens: a }
      ]
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('only 2 distinct token sets')
    );
    warn.mockRestore();
  });

  it('does not warn about deliberate holds or the cycle closing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    defineThemeSystem({
      name: 'held',
      staticThemes,
      stops: [
        { minute: 0, appearance: 'dark', phase: 'night', tokens: a },
        // A hold: same palette as the previous stop, on purpose.
        { minute: 300, appearance: 'dark', phase: 'night', tokens: a },
        { minute: 301, appearance: 'light', phase: 'day', tokens: b },
        // The cycle closing back to the opening palette.
        { minute: 1200, appearance: 'dark', phase: 'night', tokens: a }
      ]
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
