import { describe, expect, it } from 'vitest';
import { must } from './must.js';
import { defineThemeSystem, serializeOklch } from '../src/core.js';
import { inspectSchedule } from '../src/inspect.js';
import { contrastFirst } from '../src/presets/contrast-first.js';
import { dawnToDusk } from '../src/presets/dawn-to-dusk.js';
import { extendPreset } from '../src/solve.js';
import {
  GAMUT_CHROMA_SAFETY,
  PER_SECOND,
  findContrastViolations,
  findRenderedPathViolations,
  maxChromaInGamut
} from '../src/testing.js';

/** A brand dark enough to hold light text at every hour of the day. */
const brandArc = {
  light: 'oklch(0.48 0.16 265 / 1)',
  dark: 'oklch(0.44 0.15 265 / 1)'
} as const;

describe('extendPreset', () => {
  it('adds tokens that stay certified at one-second resolution', () => {
    const extended = extendPreset(dawnToDusk, {
      tokens: {
        brand: brandArc,
        brandForeground: { on: 'brand', min: 'AA' },
        muted: { on: 'background', min: 'AA-large' }
      }
    });
    expect(extended.tokenKeys).toContain('brand');
    expect(extended.tokenKeys).toContain('brandForeground');
    expect(
      findContrastViolations(extended, { stepMinutes: PER_SECOND })
    ).toEqual([]);
    expect(findRenderedPathViolations(extended)).toEqual([]);
  });

  it('leaves the preset it was given untouched', () => {
    const before = dawnToDusk.tokenKeys.length;
    extendPreset(dawnToDusk, { tokens: { muted: { on: 'background' } } });
    expect(dawnToDusk.tokenKeys).toHaveLength(before);
    expect(dawnToDusk.tokenKeys).not.toContain('muted');
  });

  it('declares the role for a pinned token so it is certified from then on', () => {
    const extended = extendPreset(dawnToDusk, {
      tokens: { muted: { on: 'background', min: 'AA-large' } }
    });
    expect(
      extended.roles.map((role) => `${role.fg} on ${role.bg} @${role.min}`)
    ).toContain('muted on background @AA-large');
  });

  it('refuses an arc that nothing certifies', () => {
    expect(() =>
      extendPreset(dawnToDusk, {
        tokens: { brand: brandArc }
      })
    ).toThrow(/has no role/);
  });

  it('accepts an uncertified arc only when it is declared decorative', () => {
    const extended = extendPreset(dawnToDusk, {
      tokens: {
        shadow: {
          light: 'oklch(0.2 0.02 265 / 0.12)',
          dark: 'oklch(0 0 none / 0.5)',
          decorative: true
        }
      }
    });
    expect(extended.tokenKeys).toContain('shadow');
    // Alpha rides the arc as well, which is the point for a shadow.
    const night = must(
      must(extended.stops[0], 'first stop').tokens.shadow,
      'shadow at night'
    );
    const noon = must(
      must(
        extended.stops.find((stop) => stop.minute === 720),
        'noon stop'
      ).tokens.shadow,
      'shadow at noon'
    );
    expect(night.alpha).toBeGreaterThan(noon.alpha);
  });

  it('keeps a brand hue fixed while solving only its lightness', () => {
    // What a brand colour actually needs: the identity is the hue and the
    // chroma, and the lightness is whatever keeps it visible. A fixed
    // two-point arc cannot do this, because the background sweeps L 0.15 to
    // 0.985 and no single pair of colours stays 3:1 from both ends.
    const extended = extendPreset(dawnToDusk, {
      tokens: {
        brand: { on: 'background', min: 'non-text', hue: 265, chroma: 0.14 }
      }
    });
    expect(
      findContrastViolations(extended, { stepMinutes: PER_SECOND })
    ).toEqual([]);
    for (const stop of extended.stops) {
      const brand = must(stop.tokens.brand, 'brand');
      // Hue is the identity and is kept exactly. Chroma is kept as far as the
      // gamut allows and no further: solving lightness moves the colour, and
      // 0.14 chroma at hue 265 does not exist at every lightness. Asserting
      // the requested value would be asserting that the browser renders a
      // colour it cannot.
      expect(brand.h).toBe(265);
      const ceiling = maxChromaInGamut(brand.l, 265) * GAMUT_CHROMA_SAFETY;
      expect(brand.c).toBeCloseTo(Math.min(0.14, ceiling), 4);
    }
    // It tracks the page rather than a fixed lightness: darker than the
    // background on the light half, lighter on the dark half. Absolute
    // lightness is not the thing to check, since a blue at L=0.66 already
    // carries less luminance than a neutral at L=0.49.
    const noon = must(
      extended.stops.find((stop) => stop.minute === 720),
      'noon stop'
    );
    const night = must(extended.stops[0], 'first stop');
    expect(must(noon.tokens.brand, 'brand').l).toBeLessThan(
      must(noon.tokens.background, 'background').l
    );
    expect(must(night.tokens.brand, 'brand').l).toBeGreaterThan(
      must(night.tokens.background, 'background').l
    );
  });

  it('extends the static themes, not only the schedule', () => {
    // `mode: 'light'` and `mode: 'dark'` serve these, so a token missing here
    // disappears the moment a user pins the mode.
    const extended = extendPreset(dawnToDusk, {
      tokens: { muted: { on: 'background' } }
    });
    expect(extended.staticThemes.light.muted).toBeDefined();
    expect(extended.staticThemes.dark.muted).toBeDefined();
    expect(must(extended.staticThemes.light.muted, 'muted').l).toBeLessThan(
      must(extended.staticThemes.dark.muted, 'muted').l
    );
  });

  it('keeps the preset switch as the only discontinuity', () => {
    // The reason direction is fixed per polarity region: a token free to pick
    // a side stop by stop would cross mid-interval, adding an undeclared jump
    // to a schedule certified without one.
    const before = inspectSchedule(dawnToDusk).holds;
    const after = inspectSchedule(
      extendPreset(dawnToDusk, {
        tokens: {
          brand: brandArc,
          brandForeground: { on: 'brand', min: 'AA' },
          muted: { on: 'background', min: 'AA-large' }
        }
      })
    ).holds;
    expect(after.map((hold) => hold.start)).toEqual(
      before.map((hold) => hold.start)
    );
  });

  it('lets a pinned token run opposite to the page when it has to', () => {
    // A light accent needs dark text even in dark mode, and vice versa. A rule
    // that forced agreement with `appearance` would refuse the commonest
    // thing anyone adds.
    const extended = extendPreset(dawnToDusk, {
      tokens: {
        brand: brandArc,
        brandForeground: { on: 'brand', min: 'AA' }
      }
    });
    const noon = must(
      extended.stops.find((stop) => stop.minute === 720),
      'noon stop'
    );
    expect(noon.appearance).toBe('light');
    // Light text on a dark blue button, while the page around it is light.
    expect(
      must(noon.tokens.brandForeground, 'brandForeground').l
    ).toBeGreaterThan(must(noon.tokens.brand, 'brand').l);
  });

  it('says which arc failed and why, without repainting it', () => {
    // A supplied colour is checked, never adjusted: quietly changing someone's
    // brand colour to reach a ratio is worse than saying it does not reach one.
    let message = '';
    try {
      // Stays darker than the page at every hour, so it never swaps sides -
      // the crossing validator has nothing to say and extendPreset's own
      // verification is what reports. Against a 0.13-lightness night sky a
      // near-black brand is simply not visible.
      extendPreset(dawnToDusk, {
        tokens: {
          brand: {
            light: 'oklch(0.05 0.01 265 / 1)',
            dark: 'oklch(0.05 0.01 265 / 1)'
          }
        },
        roles: { pairs: [{ bg: 'background', fg: 'brand', min: 'non-text' }] }
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"brand" on "background"');
    expect(message).toContain('arc you supplied');
    expect(message).toContain('checked rather than adjusted');
  });

  it('explains a background no text colour can sit on', () => {
    // This brand passes through the band where neither black nor white clears
    // AA, so no solver could succeed. Saying that is more use than a ratio.
    let message = '';
    try {
      extendPreset(dawnToDusk, {
        tokens: {
          brand: {
            light: 'oklch(0.5 0.16 265 / 1)',
            dark: 'oklch(0.78 0.12 265 / 1)',
            decorative: true
          },
          brandForeground: { on: 'brand', min: 'AA' }
        }
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('No text colour works');
    expect(message).toContain('neither black nor white');
    expect(message).toMatch(/White bottoms out at \d+\.\d+:1 at \d\d:\d\d/);
    expect(message).toMatch(/black bottoms out at \d+\.\d+:1 at \d\d:\d\d/);
  });

  it('works on a preset whose lightness barely moves', () => {
    // contrast-first carries time in hue and chroma, so the anchor arc is
    // nearly flat within each polarity. New tokens should still be legible.
    const extended = extendPreset(contrastFirst, {
      tokens: { muted: { on: 'background', min: 'AAA' } }
    });
    expect(
      findContrastViolations(extended, { stepMinutes: PER_SECOND })
    ).toEqual([]);
  });

  it('rejects the mistakes that would otherwise fail silently', () => {
    expect(() => extendPreset(dawnToDusk, { tokens: {} })).toThrow(
      /at least one token/
    );
    expect(() =>
      extendPreset(dawnToDusk, { tokens: { background: { on: 'surface' } } })
    ).toThrow(/cannot redefine "background"/);
    expect(() =>
      extendPreset(dawnToDusk, { tokens: { muted: { on: 'nope' } } })
    ).toThrow(/not a token of this preset/);
    expect(() =>
      extendPreset(dawnToDusk, {
        tokens: { muted: { on: 'background' } },
        anchor: 'nope'
      })
    ).toThrow(/anchor "nope" is not a token/);

    // No roles means no anchor to infer, so it has to be given.
    const roleless = defineThemeSystem({
      staticThemes: {
        light: { background: 'oklch(0.97 0.01 90 / 1)' },
        dark: { background: 'oklch(0.15 0.03 265 / 1)' }
      },
      stops: [
        {
          minute: 0,
          appearance: 'dark',
          phase: 'a',
          tokens: { background: 'oklch(0.15 0.03 265 / 1)' }
        },
        {
          minute: 720,
          appearance: 'dark',
          phase: 'b',
          tokens: { background: 'oklch(0.22 0.03 265 / 1)' }
        }
      ]
    });
    expect(() =>
      extendPreset(roleless, {
        tokens: {
          shadow: {
            light: 'oklch(0.2 0.02 90 / 0.2)',
            dark: 'oklch(0.1 0.02 265 / 0.6)',
            decorative: true
          }
        }
      })
    ).toThrow(/pass `anchor` explicitly/);
  });

  it('tells you to reorder tokens that depend on each other', () => {
    expect(() =>
      extendPreset(dawnToDusk, {
        tokens: {
          brandForeground: { on: 'brand', min: 'AA' },
          brand: brandArc
        }
      })
    ).toThrow(/list it before "brandForeground"/);
  });

  it('tightens a role on tokens the preset already has', () => {
    // Not only for adding colours: declaring a stricter pair over existing
    // tokens is how you find out whether a preset clears a bar it never
    // claimed. dawn-to-dusk certifies its accent at AA, not AAA.
    let message = '';
    try {
      extendPreset(dawnToDusk, {
        tokens: { muted: { on: 'background' } },
        roles: { pairs: [{ bg: 'accent', fg: 'accentForeground', min: 'AAA' }] }
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"accentForeground" on "accent"');
    expect(message).toContain('Tried margins up to');
  });

  it('copes with an anchor that does not move between the static themes', () => {
    // A theme carrying time entirely in hue has no lightness arc to ride, so
    // supplied arcs sit at their dark value rather than dividing by zero.
    const flat = defineThemeSystem({
      staticThemes: {
        light: {
          background: 'oklch(0.5 0.02 90 / 1)',
          foreground: 'oklch(0.95 0.02 90 / 1)'
        },
        dark: {
          background: 'oklch(0.5 0.02 265 / 1)',
          foreground: 'oklch(0.95 0.02 265 / 1)'
        }
      },
      roles: {
        pairs: [{ bg: 'background', fg: 'foreground', min: 'AA-large' }]
      },
      stops: [
        {
          minute: 0,
          appearance: 'dark',
          phase: 'a',
          tokens: {
            background: 'oklch(0.5 0.02 265 / 1)',
            foreground: 'oklch(0.95 0.02 265 / 1)'
          }
        },
        {
          minute: 720,
          appearance: 'dark',
          phase: 'b',
          tokens: {
            background: 'oklch(0.5 0.02 90 / 1)',
            foreground: 'oklch(0.95 0.02 90 / 1)'
          }
        }
      ]
    });
    const extended = extendPreset(flat, {
      tokens: {
        shadow: {
          light: 'oklch(0.2 0.02 90 / 0.2)',
          dark: 'oklch(0.1 0.02 265 / 0.6)',
          decorative: true
        }
      }
    });
    for (const stop of extended.stops) {
      expect(must(stop.tokens.shadow, 'shadow').alpha).toBeCloseTo(0.6, 6);
    }
  });

  it('renames only when asked', () => {
    expect(
      extendPreset(dawnToDusk, { tokens: { muted: { on: 'background' } } }).name
    ).toBe('dawn-to-dusk');
    expect(
      extendPreset(dawnToDusk, {
        name: 'ours',
        tokens: { muted: { on: 'background' } }
      }).name
    ).toBe('ours');
  });

  it('serialises to values a browser will accept', () => {
    const extended = extendPreset(dawnToDusk, {
      tokens: { muted: { on: 'background' } }
    });
    for (const stop of extended.stops) {
      expect(serializeOklch(must(stop.tokens.muted, 'muted'))).toMatch(
        /^oklch\([\d.]+ [\d.]+ ([\d.]+|none) \/ [\d.]+\)$/
      );
    }
  });
});
