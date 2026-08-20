import { describe, expect, it } from 'vitest';
import { must } from './must.js';
import {
  GAMUT_CHROMA_SAFETY,
  clampChromaToGamut,
  contrastRatio,
  isOutOfSrgbGamut,
  maxChromaInGamut
} from '../src/testing.js';

describe('maxChromaInGamut', () => {
  it('reports a value that fits and a hair more that does not', () => {
    for (const [l, h] of [
      [0.5, 30],
      [0.5, 145],
      [0.78, 292],
      [0.2, 265]
    ] as const) {
      const max = maxChromaInGamut(l, h);
      expect(isOutOfSrgbGamut({ l, c: max, h, alpha: 1 })).toBe(false);
      expect(isOutOfSrgbGamut({ l, c: max + 0.01, h, alpha: 1 })).toBe(true);
    }
  });

  it('shows why a dark amber accent cannot be authored', () => {
    // The concrete failure this exists for: a preset accent was written at
    // 0.14 chroma around hue 90 and sat 1.86e-1 outside the gamut, so the
    // browser clipped it and the certified contrast was not the rendered one.
    const warm = maxChromaInGamut(0.5, 90);
    const cool = maxChromaInGamut(0.5, 265);
    expect(warm).toBeLessThan(0.14);
    expect(cool).toBeGreaterThan(warm);
  });

  it('collapses to nothing at the ends of the lightness range', () => {
    expect(maxChromaInGamut(0, 30)).toBe(0);
    expect(maxChromaInGamut(1, 30)).toBe(0);
    expect(maxChromaInGamut(-0.2, 30)).toBe(0);
    expect(maxChromaInGamut(1.5, 30)).toBe(0);
    expect(maxChromaInGamut(Number.NaN, 30)).toBe(0);
  });

  it('treats a missing hue as hue zero rather than refusing', () => {
    expect(maxChromaInGamut(0.5, null)).toBeCloseTo(
      maxChromaInGamut(0.5, 0),
      6
    );
  });
});

describe('clampChromaToGamut', () => {
  it('leaves lightness alone, because contrast is computed from it', () => {
    const asked = { l: 0.5, c: 0.3, h: 90, alpha: 1 };
    const fitted = clampChromaToGamut(asked);
    expect(fitted.l).toBe(0.5);
    expect(fitted.h).toBe(90);
    expect(fitted.alpha).toBe(1);
    expect(fitted.c).toBeLessThan(asked.c);
    expect(isOutOfSrgbGamut(fitted)).toBe(false);
  });

  it('returns colours that already fit unchanged', () => {
    const modest = { l: 0.5, c: 0.02, h: 90, alpha: 1 };
    expect(clampChromaToGamut(modest)).toBe(modest);
  });

  it('leaves headroom so interpolating between two fitted colours stays in', () => {
    // Two colours can each sit inside the gamut while the line between them
    // leaves it. Sitting on the boundary measured 18 of 101 samples outside.
    const a = clampChromaToGamut({ l: 0.97, c: 0.3, h: 95, alpha: 1 });
    const b = clampChromaToGamut({ l: 0.55, c: 0.3, h: 30, alpha: 1 });
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100;
      expect(
        isOutOfSrgbGamut({
          l: a.l + (b.l - a.l) * t,
          c: a.c + (b.c - a.c) * t,
          h: must(a.h, 'hue a') + (must(b.h, 'hue b') - must(a.h, 'hue a')) * t,
          alpha: 1
        })
      ).toBe(false);
    }
  });

  it('honours an explicit safety factor', () => {
    const asked = { l: 0.5, c: 0.3, h: 90, alpha: 1 };
    expect(clampChromaToGamut(asked, 1).c).toBeGreaterThan(
      clampChromaToGamut(asked, GAMUT_CHROMA_SAFETY).c
    );
  });

  it('keeps the contrast maths honest about what will be painted', () => {
    // The point of clamping: a colour outside the gamut is rendered as
    // something else, so a ratio computed from the requested value is a ratio
    // for a colour nobody sees.
    const asked = { l: 0.55, c: 0.3, h: 145, alpha: 1 };
    const painted = clampChromaToGamut(asked, 1);
    const white = { l: 1, c: 0, h: null, alpha: 1 };
    expect(contrastRatio(asked, white)).not.toBeCloseTo(
      contrastRatio(painted, white),
      3
    );
  });
});
