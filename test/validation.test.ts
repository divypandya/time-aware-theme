import { describe, expect, it } from 'vitest';
import {
  MINUTES_PER_DAY,
  defineThemeSystem,
  normalizeMinute,
  resolveThemeAt,
  serializeOklch
} from '../src/core.js';

const staticThemes = {
  light: { background: 'oklch(0.97 0 none / 1)' },
  dark: { background: 'oklch(0.13 0 none / 1)' }
};

function withToken(token: unknown) {
  return defineThemeSystem({
    staticThemes: {
      light: { background: token as string },
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
}

function tokenValue(token: unknown) {
  return withToken(token).staticThemes.light.background;
}

describe('normalizeMinute', () => {
  it('wraps and truncates', () => {
    expect(normalizeMinute(0)).toBe(0);
    expect(normalizeMinute(MINUTES_PER_DAY)).toBe(0);
    expect(normalizeMinute(MINUTES_PER_DAY + 90)).toBe(90);
    expect(normalizeMinute(-1)).toBe(1439);
    expect(normalizeMinute(-MINUTES_PER_DAY - 30)).toBe(1410);
    // Truncation is what makes integer minutes the complete observable set.
    expect(normalizeMinute(90.9)).toBe(90);
    expect(normalizeMinute(-0.5)).toBe(0);
  });

  it('rejects non-finite input', () => {
    expect(() => normalizeMinute(Number.NaN)).toThrow(/finite/);
    expect(() => normalizeMinute(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe('OKLCH parsing', () => {
  it('accepts percentage lightness and alpha', () => {
    expect(tokenValue('oklch(50% 0.1 250 / 50%)')).toMatchObject({
      l: 0.5,
      alpha: 0.5
    });
  });

  it('accepts every hue unit', () => {
    expect(tokenValue('oklch(0.5 0.1 180deg)')?.h).toBeCloseTo(180, 5);
    expect(tokenValue('oklch(0.5 0.1 0.5turn)')?.h).toBeCloseTo(180, 5);
    expect(tokenValue('oklch(0.5 0.1 200grad)')?.h).toBeCloseTo(180, 5);
    expect(tokenValue('oklch(0.5 0.1 3.14159265rad)')?.h).toBeCloseTo(180, 4);
  });

  it('normalises out-of-range hues', () => {
    expect(tokenValue('oklch(0.5 0.1 420)')?.h).toBeCloseTo(60, 5);
    expect(tokenValue('oklch(0.5 0.1 -30)')?.h).toBeCloseTo(330, 5);
  });

  it('treats "none" as an absent hue', () => {
    const token = tokenValue('oklch(0.5 0 none)');
    expect(token?.h).toBeNull();
    expect(token?.alpha).toBe(1);
  });

  it('accepts an object form', () => {
    expect(tokenValue({ l: 0.5, c: 0.1, h: 250 })).toMatchObject({
      l: 0.5,
      c: 0.1,
      h: 250,
      alpha: 1
    });
  });

  it('rejects malformed values', () => {
    expect(() => withToken('rgb(1 2 3)')).toThrow(/valid oklch\(\) string/);
    expect(() => withToken('oklch()')).toThrow();
    expect(() => withToken('oklch(0.5 0.1)')).toThrow(/lightness, chroma/);
    expect(() => withToken('oklch(0.5 0.1 250 / )')).toThrow(/both sides/);
    expect(() => withToken('oklch(0.5 0.1 fuchsia)')).toThrow(/finite hue/);
    expect(() => withToken(null)).toThrow(/OKLCH string or object/);
    expect(() => withToken(42)).toThrow(/OKLCH string or object/);
  });

  it('rejects out-of-range channels', () => {
    expect(() => withToken('oklch(1.5 0.1 250)')).toThrow(/between 0 and 1/);
    expect(() => withToken('oklch(-0.1 0.1 250)')).toThrow(/between 0 and 1/);
    expect(() => withToken('oklch(0.5 -0.1 250)')).toThrow(/non-negative/);
    expect(() => withToken('oklch(0.5 0.1 250 / 2)')).toThrow(
      /between 0 and 1/
    );
    expect(() => withToken({ l: 0.5, c: 0.1 })).toThrow(/required when chroma/);
  });

  it('round-trips through serializeOklch', () => {
    const token = tokenValue('oklch(0.5 0.1 250 / 0.5)');
    expect(token && serializeOklch(token)).toBe('oklch(0.5 0.1 250 / 0.5)');
    const grey = tokenValue('oklch(0.5 0 none)');
    expect(grey && serializeOklch(grey)).toBe('oklch(0.5 0 none / 1)');
  });
});

describe('defineThemeSystem validation', () => {
  const tokens = { background: 'oklch(0.13 0 none / 1)' };
  const stop = {
    minute: 0,
    appearance: 'dark' as const,
    phase: 'night',
    tokens
  };

  it('requires static themes', () => {
    expect(() => defineThemeSystem(undefined as never)).toThrow(
      /requires staticThemes/
    );
    expect(() =>
      defineThemeSystem({ staticThemes: null, stops: [] } as never)
    ).toThrow(/requires staticThemes/);
    expect(() =>
      defineThemeSystem({
        staticThemes: { light: tokens },
        stops: [stop]
      } as never)
    ).toThrow(/both light and dark/);
  });

  it('requires at least one token and one stop', () => {
    expect(() =>
      // Empty stops keep TTokens inferring from the (empty) static themes;
      // the token check runs before the stop check, so this still exercises it.
      defineThemeSystem({ staticThemes: { light: {}, dark: {} }, stops: [] })
    ).toThrow(/at least one token/);
    expect(() => defineThemeSystem({ staticThemes, stops: [] })).toThrow(
      /at least one stop/
    );
  });

  it('requires consistent token keys', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes: {
          light: { background: 'oklch(0.97 0 none / 1)' },
          dark: {
            background: 'oklch(0.13 0 none / 1)',
            extra: 'oklch(0.5 0 none / 1)'
          }
        },
        stops: [stop]
      })
    ).toThrow(/exactly 1 token keys/);

    expect(() =>
      defineThemeSystem({
        staticThemes: {
          light: { background: 'oklch(0.97 0 none / 1)' },
          dark: { wrongName: 'oklch(0.13 0 none / 1)' }
        },
        stops: [stop]
      })
    ).toThrow(/unexpected token key/);
  });

  it('requires ordered unique stop minutes', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes,
        stops: [stop, { ...stop, minute: 0, phase: 'dupe' }]
      })
    ).toThrow(/Duplicate stop minute/);

    expect(() =>
      defineThemeSystem({
        staticThemes,
        stops: [
          { ...stop, minute: 600 },
          { ...stop, minute: 300 }
        ]
      })
    ).toThrow(/strictly increasing/);
  });

  it('validates stop fields', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes,
        stops: [{ ...stop, minute: Number.NaN }]
      })
    ).toThrow(/minute must be a finite number/);

    expect(() =>
      defineThemeSystem({
        staticThemes,
        stops: [{ ...stop, appearance: 'twilight' }]
      } as never)
    ).toThrow(/appearance must be "light" or "dark"/);

    expect(() =>
      defineThemeSystem({ staticThemes, stops: [{ ...stop, phase: '' }] })
    ).toThrow(/phase must be a non-empty string/);

    expect(() =>
      defineThemeSystem({
        staticThemes,
        stops: [{ ...stop, tokens: null }]
      } as never)
    ).toThrow(/must be an object/);
  });

  it('validates role declarations', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes,
        roles: { pairs: null },
        stops: [stop]
      } as never)
    ).toThrow(/roles.pairs must be an array/);

    expect(() =>
      defineThemeSystem({
        staticThemes,
        roles: { pairs: [null] },
        stops: [stop]
      } as never)
    ).toThrow(/must be an object/);

    expect(() =>
      defineThemeSystem({
        staticThemes,
        roles: { pairs: [{ bg: 'background', fg: 'background', min: 'AAAA' }] },
        stops: [stop]
      } as never)
    ).toThrow(/must be "AAA", "AA", "AA-large", or "non-text"/);
  });

  it('defaults a role pair to AA', () => {
    const system = defineThemeSystem({
      staticThemes,
      roles: { pairs: [{ bg: 'background', fg: 'background' }] },
      stops: [stop]
    });
    expect(system.roles[0]?.min).toBe('AA');
  });

  it('exposes an empty role list when none are declared', () => {
    expect(defineThemeSystem({ staticThemes, stops: [stop] }).roles).toEqual(
      []
    );
  });

  it('freezes the resulting system', () => {
    const system = defineThemeSystem({ staticThemes, stops: [stop] });
    expect(Object.isFrozen(system)).toBe(true);
    expect(Object.isFrozen(system.stops)).toBe(true);
    expect(Object.isFrozen(resolveThemeAt(system, 0))).toBe(true);
  });
});
