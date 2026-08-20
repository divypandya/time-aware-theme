/**
 * Generates the shipped presets.
 *
 * Preset palettes are hand-specified only where a human judgement is involved
 * — the background and accent arc through the day. Every derived token
 * (foreground, surface, surfaceForeground, accentForeground) is *solved* for a
 * target contrast ratio and then clamped into the sRGB gamut.
 *
 * Hand-authoring these was how the original invisible-text bug happened: a
 * human cannot eyeball whether oklch(0.57 0.02 260) on oklch(0.57 0.03 255)
 * is legible, and there are hundreds of such judgements in four presets. The
 * generator emits plain literals, so nothing here runs in a consumer's bundle.
 *
 * Regenerate with: node scripts/generate-presets.mjs
 */
import { writeFileSync } from 'node:fs';
import { defineThemeSystem } from '../dist/index.js';
import { solveSchedule } from '../dist/solve.js';
import {
  GAMUT_CHROMA_SAFETY,
  clampChromaToGamut,
  contrastRatio,
  findContrastViolations,
  isOutOfSrgbGamut,
  sampleSchedule
} from '../dist/testing.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, places = 4) => Number.parseFloat(value.toFixed(places));

// The bisection and the safety margin both live in the package now, exported
// from /testing, so a user fitting their own colours gets the same answer this
// generator does rather than a near-copy that drifts.
function fit(color) {
  const c = clampChromaToGamut({ ...color, alpha: 1 }, GAMUT_CHROMA_SAFETY).c;
  return { l: round(color.l), c: round(c), h: round(color.h, 2), alpha: 1 };
}

function solveInDirection(against, { c, h }, target, direction) {
  let low = direction > 0 ? against.l : 0;
  let high = direction > 0 ? 1 : against.l;

  for (let i = 0; i < 48; i += 1) {
    const mid = (low + high) / 2;
    const ratio = contrastRatio(against, fit({ l: mid, c, h, alpha: 1 }));
    if (direction > 0) {
      if (ratio < target) low = mid;
      else high = mid;
    } else {
      if (ratio < target) high = mid;
      else low = mid;
    }
  }
  return fit({ l: direction > 0 ? high : low, c, h, alpha: 1 });
}

/**
 * Solves for the lightness hitting `target` contrast against `against`.
 *
 * Tries both directions and keeps whichever wins. Guessing the direction from
 * whether the base is above or below L=0.5 is wrong for mid-lightness colours:
 * an accent at L=0.50 reaches 6.33:1 against white but only 3.27:1 against
 * black, and the naive heuristic picks black.
 */
function solveLightness(against, spec, target) {
  const lighter = solveInDirection(against, spec, target, 1);
  const darker = solveInDirection(against, spec, target, -1);
  const lighterRatio = contrastRatio(against, lighter);
  const darkerRatio = contrastRatio(against, darker);
  return lighterRatio >= darkerRatio ? lighter : darker;
}

/**
 * Text sits near the end of the lightness range, not at the nearest value that
 * reaches a target.
 *
 * This is the whole reason 0.4.0's presets glide where 0.3.0's stepped. The
 * background has to cross from "dark enough for light text" to "light enough
 * for dark text", and the forbidden band between those is
 *
 *     gap = t * (Y_darkText + 0.05) - (Y_lightText + 0.05) / t
 *
 * which shrinks as the two text colours move *apart*, not together. Solving
 * each foreground for the nearest lightness hitting 9:1 put them at L=0.395
 * and L=0.755 and left a gap of 0.396 in luminance - roughly half the
 * background's whole daily range, jumped in one frame. Pinning them near black
 * and near white closes it: at AA the gap reaches zero once t^2 <= 21, and
 * 4.5^2 = 20.25 fits with room to spare.
 *
 * At AAA it does not fit - 7^2 = 49 - so contrast-first keeps a step no matter
 * what is done to its palette. That is a fact about the ratio, not a defect.
 */
function textLightnessFor(spec, dark) {
  return dark ? (spec.textOnDarkL ?? 0.985) : (spec.textOnLightL ?? 0.145);
}

/**
 * Uses the pinned lightness when it clears the target, and solves when it does
 * not.
 *
 * The fallback is not decoration: a phase whose background sits near mid-grey
 * has no legible text at either extreme, and silently emitting the pinned
 * value would ship an illegible phase that certification then rejects with a
 * far less obvious message.
 */
function fitText(against, textSpec, wantedL, target) {
  const pinned = fit({ ...textSpec, l: wantedL, alpha: 1 });
  if (contrastRatio(against, pinned) >= target) {
    return pinned;
  }
  return solveLightness(against, textSpec, target);
}

/**
 * Fits an accent so it can carry text of one fixed polarity.
 *
 * Hue and chroma are the design decision and are kept exactly; lightness is
 * solved, because lightness is what contrast is spent from. An accent authored
 * at L=0.5 is the worst case for carrying text at all - near-white reaches
 * only 4.4:1 on it and near-black 4.8:1 - and asking a person to hand-place a
 * value that clears a target against a fixed text colour, in every phase, is
 * asking them to run this bisection in their head.
 *
 * The authored lightness is kept when it already works, so a deliberate choice
 * survives and only an unworkable one is moved.
 */
function fitAccent(spec, accentTextL, target) {
  const authored = fit(spec.accent);
  const text = fit({ l: accentTextL, c: 0.01, h: authored.h, alpha: 1 });
  if (contrastRatio(authored, text) >= target) {
    return authored;
  }
  // Light text means the accent has to move darker, and the reverse.
  const direction = accentTextL > 0.5 ? -1 : 1;
  const solved = solveInDirection(
    text,
    { c: authored.c, h: authored.h },
    target,
    direction
  );
  if (contrastRatio(solved, text) + 1e-9 < target) {
    throw new Error(
      `accent at hue ${authored.h} chroma ${authored.c} cannot reach ` +
        `${target}:1 against text at L=${accentTextL} at any lightness. ` +
        'Lower the chroma, or carry the accent text at the other polarity.'
    );
  }
  return solved;
}

/** Builds a full token set from a background and an accent. */
function buildPhase(spec) {
  const background = fit(spec.background);
  const dark = background.l < 0.5;
  const target = spec.textContrast ?? 9;

  const textSpec = {
    c: spec.foregroundChroma ?? 0.015,
    h: spec.foregroundHue ?? background.h
  };
  const wantedText = textLightnessFor(spec, dark);

  const foreground = fitText(background, textSpec, wantedText, target);

  // A raised surface sits slightly toward mid-grey from the page.
  const surface = fit({
    l: clamp(background.l + (dark ? 0.05 : -0.035), 0, 1),
    c: background.c,
    h: background.h,
    alpha: 1
  });
  const surfaceForeground = fitText(surface, textSpec, wantedText, target);

  // The accent keeps one polarity all day, so its text never changes sides.
  // In 0.3.0 this pair was the single largest jump in every AA preset -
  // accentForeground moved 0.659 in lightness while the accent itself moved
  // 0.146. A primary button inverting at dusk is not something anyone asked
  // for, and it cost more than the page change did.
  //
  // `accentTextL` is decided once for the whole preset, never here. Choosing
  // per phase is what put the flip back in tidal: its cyan accents sit close
  // enough to mid-lightness that one phase preferred black while its
  // neighbour preferred white, and the pair crossed between them.
  const accentTarget = spec.accentTextContrast ?? 6;
  const accent = fitAccent(spec, spec.accentTextL, accentTarget);
  const accentForeground = fit({
    l: spec.accentTextL,
    c: 0.01,
    h: accent.h,
    alpha: 1
  });

  return {
    background,
    foreground,
    surface,
    surfaceForeground,
    accent,
    accentForeground
  };
}

const css = (color) =>
  `oklch(${color.l} ${color.c} ${color.h === null ? 'none' : color.h} / 1)`;

function tokensLiteral(tokens, indent) {
  const pad = ' '.repeat(indent);
  return Object.entries(tokens)
    .map(([key, value]) => `${pad}${key}: '${css(value)}'`)
    .join(',\n');
}

// ---------------------------------------------------------------------------
// Preset specifications. Only these numbers are a design decision.
//
// Accent hues in the light phases stay clear of yellow (roughly 60-110): sRGB
// max chroma at L=0.5 collapses to ~0.10 there against ~0.20 at hue 30, so a
// dark yellow accent simply does not exist.
// ---------------------------------------------------------------------------
const presets = [
  {
    id: 'dawn-to-dusk',
    name: 'Dawn to dusk',
    description:
      'Warm arc: indigo night, amber sunrise, neutral midday, ember dusk.',
    phases: {
      deepNight: {
        background: { l: 0.15, c: 0.028, h: 265 },
        accent: { l: 0.56, c: 0.15, h: 292 }
      },
      dawn: {
        background: { l: 0.21, c: 0.045, h: 285 },
        accent: { l: 0.55, c: 0.16, h: 320 }
      },
      sunrise: {
        background: { l: 0.97, c: 0.018, h: 68 },
        accent: { l: 0.53, c: 0.15, h: 38 }
      },
      midday: {
        background: { l: 0.985, c: 0.006, h: 95 },
        accent: { l: 0.5, c: 0.14, h: 30 }
      },
      afternoon: {
        background: { l: 0.955, c: 0.016, h: 78 },
        accent: { l: 0.51, c: 0.15, h: 35 }
      },
      dusk: {
        background: { l: 0.925, c: 0.026, h: 58 },
        accent: { l: 0.52, c: 0.15, h: 28 }
      },
      eveningNight: {
        background: { l: 0.19, c: 0.04, h: 300 },
        accent: { l: 0.55, c: 0.16, h: 330 }
      }
    }
  },
  {
    id: 'tidal',
    name: 'Tidal',
    description:
      'Cool arc: cyan through slate, no warm hues. For products where amber reads as a warning.',
    phases: {
      deepNight: {
        background: { l: 0.15, c: 0.03, h: 250 },
        accent: { l: 0.45, c: 0.12, h: 228 }
      },
      dawn: {
        background: { l: 0.2, c: 0.04, h: 235 },
        accent: { l: 0.45, c: 0.12, h: 236 }
      },
      sunrise: {
        background: { l: 0.97, c: 0.014, h: 210 },
        accent: { l: 0.52, c: 0.13, h: 245 }
      },
      midday: {
        background: { l: 0.985, c: 0.008, h: 220 },
        accent: { l: 0.5, c: 0.14, h: 255 }
      },
      afternoon: {
        background: { l: 0.955, c: 0.014, h: 200 },
        accent: { l: 0.51, c: 0.13, h: 240 }
      },
      dusk: {
        background: { l: 0.925, c: 0.022, h: 215 },
        accent: { l: 0.52, c: 0.13, h: 250 }
      },
      eveningNight: {
        background: { l: 0.185, c: 0.038, h: 245 },
        accent: { l: 0.45, c: 0.12, h: 232 }
      }
    }
  },
  {
    id: 'contrast-first',
    name: 'Contrast first',
    description:
      'Every declared pair certified at AAA (7:1) across all 1,440 minutes. Time of day is carried by hue and chroma rather than lightness, because lightness is the budget contrast spends.',
    // AAA on text, and the accent pair too.
    textContrast: 13,
    accentTextContrast: 7.5,
    level: 'AAA',
    phases: {
      deepNight: {
        background: { l: 0.12, c: 0.02, h: 265 },
        accent: { l: 0.42, c: 0.13, h: 280 }
      },
      dawn: {
        background: { l: 0.13, c: 0.035, h: 290 },
        accent: { l: 0.42, c: 0.13, h: 320 }
      },
      sunrise: {
        background: { l: 0.99, c: 0.008, h: 70 },
        accent: { l: 0.42, c: 0.13, h: 35 }
      },
      midday: {
        background: { l: 0.995, c: 0.004, h: 100 },
        accent: { l: 0.4, c: 0.13, h: 25 }
      },
      afternoon: {
        background: { l: 0.985, c: 0.01, h: 80 },
        accent: { l: 0.41, c: 0.13, h: 30 }
      },
      dusk: {
        background: { l: 0.975, c: 0.014, h: 60 },
        accent: { l: 0.42, c: 0.13, h: 22 }
      },
      eveningNight: {
        background: { l: 0.13, c: 0.03, h: 300 },
        accent: { l: 0.42, c: 0.13, h: 330 }
      }
    }
  },
  {
    id: 'paper',
    name: 'Paper',
    description:
      'Near-achromatic surfaces (chroma <= 0.02) with a single chromatic accent. Doubles as the worked example for how fades to neutral behave.',
    phases: {
      deepNight: {
        background: { l: 0.15, c: 0.004, h: 260 },
        accent: { l: 0.55, c: 0.13, h: 250 }
      },
      dawn: {
        background: { l: 0.19, c: 0.008, h: 270 },
        accent: { l: 0.54, c: 0.13, h: 265 }
      },
      sunrise: {
        background: { l: 0.97, c: 0.006, h: 70 },
        accent: { l: 0.52, c: 0.13, h: 255 }
      },
      midday: {
        background: { l: 0.99, c: 0.002, h: 95 },
        accent: { l: 0.5, c: 0.13, h: 260 }
      },
      afternoon: {
        background: { l: 0.96, c: 0.006, h: 85 },
        accent: { l: 0.51, c: 0.13, h: 258 }
      },
      dusk: {
        background: { l: 0.94, c: 0.01, h: 65 },
        accent: { l: 0.52, c: 0.13, h: 252 }
      },
      eveningNight: {
        background: { l: 0.18, c: 0.006, h: 285 },
        accent: { l: 0.54, c: 0.13, h: 255 }
      }
    }
  },
  {
    id: 'nocturne',
    name: 'Nocturne',
    description:
      'Eye-comforting: the night end is dim and warm rather than blue, and midday stops short of paper white. For long sessions and dark rooms.',
    // Blue light is carried by hue, not by the lightness the contrast maths
    // spends, so a warm night costs nothing in legibility. The daytime ceiling
    // is the real concession: 0.93 instead of 0.985 is a visibly softer white.
    phases: {
      deepNight: {
        background: { l: 0.13, c: 0.012, h: 45 },
        accent: { l: 0.46, c: 0.11, h: 55 }
      },
      dawn: {
        background: { l: 0.18, c: 0.02, h: 40 },
        accent: { l: 0.46, c: 0.12, h: 45 }
      },
      sunrise: {
        background: { l: 0.9, c: 0.016, h: 62 },
        accent: { l: 0.46, c: 0.13, h: 40 }
      },
      midday: {
        background: { l: 0.93, c: 0.01, h: 75 },
        accent: { l: 0.45, c: 0.13, h: 38 }
      },
      afternoon: {
        background: { l: 0.915, c: 0.014, h: 68 },
        accent: { l: 0.46, c: 0.13, h: 42 }
      },
      dusk: {
        background: { l: 0.885, c: 0.022, h: 52 },
        accent: { l: 0.46, c: 0.12, h: 48 }
      },
      eveningNight: {
        background: { l: 0.16, c: 0.018, h: 42 },
        accent: { l: 0.46, c: 0.11, h: 52 }
      }
    }
  },
  {
    id: 'ember',
    name: 'Ember',
    description:
      'Deep warm amber throughout, with a night end closer to charcoal than to black. Reads as lamplight rather than daylight.',
    phases: {
      deepNight: {
        background: { l: 0.17, c: 0.022, h: 35 },
        accent: { l: 0.47, c: 0.15, h: 28 }
      },
      dawn: {
        background: { l: 0.23, c: 0.034, h: 30 },
        accent: { l: 0.47, c: 0.16, h: 25 }
      },
      sunrise: {
        background: { l: 0.955, c: 0.024, h: 55 },
        accent: { l: 0.46, c: 0.17, h: 32 }
      },
      midday: {
        background: { l: 0.975, c: 0.014, h: 72 },
        accent: { l: 0.45, c: 0.17, h: 38 }
      },
      afternoon: {
        background: { l: 0.95, c: 0.022, h: 60 },
        accent: { l: 0.46, c: 0.17, h: 33 }
      },
      dusk: {
        background: { l: 0.915, c: 0.036, h: 42 },
        accent: { l: 0.47, c: 0.16, h: 26 }
      },
      eveningNight: {
        background: { l: 0.2, c: 0.03, h: 32 },
        accent: { l: 0.47, c: 0.15, h: 24 }
      }
    }
  },
  {
    id: 'forest',
    name: 'Forest',
    description:
      'Muted green and moss, low chroma throughout. sRGB has little room for saturated green at low lightness, so the accent leans toward teal as it darkens.',
    phases: {
      deepNight: {
        background: { l: 0.15, c: 0.018, h: 160 },
        accent: { l: 0.45, c: 0.1, h: 175 }
      },
      dawn: {
        background: { l: 0.2, c: 0.026, h: 155 },
        accent: { l: 0.45, c: 0.1, h: 170 }
      },
      sunrise: {
        background: { l: 0.965, c: 0.016, h: 130 },
        accent: { l: 0.45, c: 0.11, h: 155 }
      },
      midday: {
        background: { l: 0.98, c: 0.01, h: 140 },
        accent: { l: 0.45, c: 0.11, h: 150 }
      },
      afternoon: {
        background: { l: 0.955, c: 0.016, h: 135 },
        accent: { l: 0.45, c: 0.11, h: 152 }
      },
      dusk: {
        background: { l: 0.925, c: 0.024, h: 145 },
        accent: { l: 0.45, c: 0.1, h: 162 }
      },
      eveningNight: {
        background: { l: 0.18, c: 0.024, h: 158 },
        accent: { l: 0.45, c: 0.1, h: 172 }
      }
    }
  },
  {
    id: 'meridian',
    name: 'Meridian',
    description:
      'Neutral and quiet: hue barely moves across the day, so the only thing that changes is the light. The default when a theme should not have opinions.',
    phases: {
      deepNight: {
        background: { l: 0.14, c: 0.006, h: 250 },
        accent: { l: 0.46, c: 0.12, h: 250 }
      },
      dawn: {
        background: { l: 0.19, c: 0.008, h: 250 },
        accent: { l: 0.46, c: 0.12, h: 250 }
      },
      sunrise: {
        background: { l: 0.965, c: 0.004, h: 250 },
        accent: { l: 0.46, c: 0.13, h: 252 }
      },
      midday: {
        background: { l: 0.985, c: 0.002, h: 250 },
        accent: { l: 0.45, c: 0.13, h: 254 }
      },
      afternoon: {
        background: { l: 0.96, c: 0.004, h: 250 },
        accent: { l: 0.46, c: 0.13, h: 252 }
      },
      dusk: {
        background: { l: 0.93, c: 0.008, h: 250 },
        accent: { l: 0.46, c: 0.12, h: 250 }
      },
      eveningNight: {
        background: { l: 0.17, c: 0.008, h: 250 },
        accent: { l: 0.46, c: 0.12, h: 250 }
      }
    }
  },
  {
    id: 'blossom',
    name: 'Blossom',
    description:
      'Soft rose and plum. The lightest of the presets by day; its night end stays tinted rather than going neutral.',
    phases: {
      deepNight: {
        background: { l: 0.16, c: 0.024, h: 340 },
        accent: { l: 0.47, c: 0.15, h: 350 }
      },
      dawn: {
        background: { l: 0.21, c: 0.034, h: 345 },
        accent: { l: 0.47, c: 0.16, h: 355 }
      },
      sunrise: {
        background: { l: 0.97, c: 0.018, h: 355 },
        accent: { l: 0.47, c: 0.17, h: 5 }
      },
      midday: {
        background: { l: 0.985, c: 0.01, h: 350 },
        accent: { l: 0.46, c: 0.17, h: 358 }
      },
      afternoon: {
        background: { l: 0.965, c: 0.016, h: 348 },
        accent: { l: 0.47, c: 0.17, h: 2 }
      },
      dusk: {
        background: { l: 0.94, c: 0.026, h: 342 },
        accent: { l: 0.47, c: 0.16, h: 352 }
      },
      eveningNight: {
        background: { l: 0.19, c: 0.03, h: 338 },
        accent: { l: 0.47, c: 0.15, h: 348 }
      }
    }
  },
  {
    id: 'slate',
    name: 'Slate',
    description:
      'Cool blue-grey with a restrained accent. Built for dense interfaces where the theme should stay behind the content.',
    phases: {
      deepNight: {
        background: { l: 0.145, c: 0.014, h: 255 },
        accent: { l: 0.45, c: 0.09, h: 240 }
      },
      dawn: {
        background: { l: 0.195, c: 0.02, h: 250 },
        accent: { l: 0.45, c: 0.09, h: 242 }
      },
      sunrise: {
        background: { l: 0.96, c: 0.01, h: 240 },
        accent: { l: 0.45, c: 0.1, h: 248 }
      },
      midday: {
        background: { l: 0.978, c: 0.006, h: 245 },
        accent: { l: 0.45, c: 0.1, h: 250 }
      },
      afternoon: {
        background: { l: 0.955, c: 0.01, h: 242 },
        accent: { l: 0.45, c: 0.1, h: 248 }
      },
      dusk: {
        background: { l: 0.925, c: 0.016, h: 248 },
        accent: { l: 0.45, c: 0.09, h: 244 }
      },
      eveningNight: {
        background: { l: 0.175, c: 0.018, h: 252 },
        accent: { l: 0.45, c: 0.09, h: 241 }
      }
    }
  }
];

let failed = false;

for (const preset of presets) {
  const built = Object.fromEntries(
    Object.entries(preset.phases).map(([key, spec]) => [
      key,
      buildPhase({
        ...spec,
        textContrast: preset.textContrast,
        accentTextContrast: preset.accentTextContrast,
        // One polarity for the whole preset. Choosing per phase is what put
        // the flip back into tidal: accents near mid-lightness disagreed with
        // their neighbours about which side their text belonged on.
        accentTextL: preset.accentTextL ?? preset.textOnDarkL ?? 0.985
      })
    ])
  );

  const level = preset.level ?? 'AA';
  const identifier = preset.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  // Fixed-polarity accents are an invariant, not a convention. Authoring one
  // light night accent among six dark ones puts the accent pair's crossing
  // back, and the only symptom is a wider step in a generated file nobody
  // reads. Checked here so it fails at the source instead.
  const accentPolarities = new Set(
    Object.values(built).map((phase) =>
      phase.accent.l < 0.5 ? 'dark' : 'light'
    )
  );
  if (accentPolarities.size > 1) {
    failed = true;
    console.error(
      `FAIL  ${preset.id}\n        accent changes polarity across phases ` +
        `(${[...accentPolarities].join(' and ')}). Its foreground would have ` +
        'to flip, which is the largest step a preset can have.'
    );
    continue;
  }

  const roles = {
    pairs: [
      { bg: 'background', fg: 'foreground', min: level },
      { bg: 'surface', fg: 'surfaceForeground', min: level },
      { bg: 'accent', fg: 'accentForeground', min: level }
    ]
  };

  // A plain day, with no appearance and no hand-placed switch. Writing those
  // by hand is what produced the asymmetry: dawn got a real hold while dusk
  // existed only as the snap stop, so its label held for sixty seconds while
  // every other phase ran for hours — identically in all four presets, because
  // one template generated them all.
  const { system: solvedInput, switches } = solveSchedule({
    name: preset.id,
    staticThemes: { light: built.midday, dark: built.deepNight },
    roles,
    curve: [
      { minute: 0, phase: 'night', tokens: built.deepNight },
      { minute: 300, phase: 'dawn', tokens: built.dawn },
      { minute: 420, phase: 'sunrise', tokens: built.sunrise },
      { minute: 720, phase: 'midday', tokens: built.midday },
      { minute: 990, phase: 'afternoon', tokens: built.afternoon },
      { minute: 1200, phase: 'dusk', tokens: built.dusk },
      // Night returns before midnight so dusk is an evening rather than a
      // quarter of the day. The switch lands inside this interval.
      { minute: 1320, phase: 'night', tokens: built.deepNight }
    ]
  });

  // Sweep it before emitting anything. A generator that can produce an
  // uncertifiable preset is just a slower way of hand-authoring the same bug.
  const system = defineThemeSystem(solvedInput);

  const violations = findContrastViolations(system);
  const outOfGamut = sampleSchedule(system).flatMap((snapshot) =>
    Object.entries(snapshot.tokens)
      .filter(([, color]) => isOutOfSrgbGamut(color))
      .map(([key]) => `${key}@${snapshot.minute}`)
  );

  if (violations.length > 0 || outOfGamut.length > 0) {
    failed = true;
    console.error(`FAIL  ${preset.id}`);
    if (violations.length > 0) {
      const worst = violations.reduce((a, b) => (b.actual < a.actual ? b : a));
      console.error(
        `        ${violations.length} contrast violation(s); worst ` +
          `${worst.actual.toFixed(2)}:1 (needs ${worst.required}:1) for ` +
          `"${worst.fg}" on "${worst.bg}" at minute ${worst.minute}`
      );
    }
    if (outOfGamut.length > 0) {
      console.error(
        `        ${outOfGamut.length} out-of-gamut value(s), first ${outOfGamut[0]}`
      );
    }
    continue;
  }

  const stopsLiteral = solvedInput.stops
    .map((stop) => {
      const tokens = Object.entries(stop.tokens)
        .map(([key, value]) => `        ${key}: '${value}'`)
        .join(',\n');
      return [
        '    {',
        `      minute: ${stop.minute},`,
        `      appearance: '${stop.appearance}',`,
        `      phase: '${stop.phase}',`,
        stop.jumpAfter ? '      jumpAfter: true,' : null,
        '      tokens: {',
        tokens,
        '      }',
        '    }'
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join(',\n');

  const switchNotes = switches
    .map(
      (swap) =>
        `//   ${String(Math.floor(swap.minute / 60)).padStart(2, '0')}:${String(swap.minute % 60).padStart(2, '0')}  ${swap.phase} -> ${swap.nextPhase}, widest step ${swap.widestJump.toFixed(3)} in lightness`
    )
    .join('\n');

  const source = `// GENERATED by scripts/generate-presets.mjs — do not edit by hand.
//
// The background and accent arcs are design decisions. Every other token is
// solved for a contrast target and clamped into the sRGB gamut; where the
// theme changes polarity is solved too, by solveSchedule, rather than placed
// by hand. Certified per second by scripts/certify.mjs.
//
// Switches:
${switchNotes}
import { defineThemeSystem } from '../core.js';

/**
 * ${preset.name} — ${preset.description}
 */
export const ${identifier} = defineThemeSystem({
  name: '${preset.id}',
  staticThemes: {
    light: {
${tokensLiteral(built.midday, 6)}
    },
    dark: {
${tokensLiteral(built.deepNight, 6)}
    }
  },
  roles: {
    pairs: [
      { bg: 'background', fg: 'foreground', min: '${level}' },
      { bg: 'surface', fg: 'surfaceForeground', min: '${level}' },
      { bg: 'accent', fg: 'accentForeground', min: '${level}' }
    ]
  },
  stops: [
${stopsLiteral}
  ]
});

export default ${identifier};
`;

  writeFileSync(
    new URL(`../src/presets/${preset.id}.ts`, import.meta.url),
    source
  );
  console.log(`generated src/presets/${preset.id}.ts  (certified ${level})`);
}

if (failed) {
  console.error(
    '\nPreset generation failed; nothing uncertifiable was written.'
  );
  process.exitCode = 1;
}
