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
import { defineThemeSystem, holdThenSnap } from '../dist/index.js';
import {
  contrastRatio,
  findContrastViolations,
  isOutOfSrgbGamut,
  sampleSchedule
} from '../dist/testing.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, places = 4) => Number.parseFloat(value.toFixed(places));

/** Largest in-gamut chroma for a given lightness and hue. */
function maxChroma(l, h) {
  let low = 0;
  let high = 0.4;
  for (let i = 0; i < 32; i += 1) {
    const mid = (low + high) / 2;
    if (isOutOfSrgbGamut({ l, c: mid, h, alpha: 1 })) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return low;
}

// Interpolating between two in-gamut OKLCH colours can still leave the sRGB
// gamut — the gamut is not convex in this space. Measured 18 of 101 samples
// out of gamut between two fitted near-white endpoints. Hence a real margin
// rather than shaving the last two percent.
const CHROMA_SAFETY = 0.86;

function fit(color) {
  const c = Math.min(color.c, maxChroma(color.l, color.h) * CHROMA_SAFETY);
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

/** Builds a full token set from a background and an accent. */
function buildPhase(spec) {
  const background = fit(spec.background);
  const dark = background.l < 0.5;
  const away = dark ? 1 : -1;

  void away;
  const textSpec = {
    c: spec.foregroundChroma ?? 0.015,
    h: spec.foregroundHue ?? background.h
  };

  // Body text aims well past AA so the interpolated interior stays clear too.
  const foreground = solveLightness(
    background,
    textSpec,
    spec.textContrast ?? 9
  );

  // A raised surface sits slightly toward mid-grey from the page.
  const surface = fit({
    l: clamp(background.l + (dark ? 0.05 : -0.035), 0, 1),
    c: background.c,
    h: background.h,
    alpha: 1
  });
  const surfaceForeground = solveLightness(
    surface,
    textSpec,
    spec.textContrast ?? 9
  );

  const accent = fit(spec.accent);
  const accentForeground = solveLightness(
    accent,
    { c: 0.01, h: accent.h },
    spec.accentTextContrast ?? 6
  );

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
        accent: { l: 0.78, c: 0.11, h: 292 }
      },
      dawn: {
        background: { l: 0.21, c: 0.045, h: 285 },
        accent: { l: 0.8, c: 0.12, h: 320 }
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
        accent: { l: 0.79, c: 0.12, h: 330 }
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
        accent: { l: 0.79, c: 0.11, h: 205 }
      },
      dawn: {
        background: { l: 0.2, c: 0.04, h: 235 },
        accent: { l: 0.8, c: 0.11, h: 195 }
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
        accent: { l: 0.78, c: 0.11, h: 200 }
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
        accent: { l: 0.85, c: 0.1, h: 280 }
      },
      dawn: {
        background: { l: 0.13, c: 0.035, h: 290 },
        accent: { l: 0.86, c: 0.1, h: 320 }
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
        accent: { l: 0.86, c: 0.1, h: 330 }
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
        accent: { l: 0.78, c: 0.1, h: 250 }
      },
      dawn: {
        background: { l: 0.19, c: 0.008, h: 270 },
        accent: { l: 0.79, c: 0.1, h: 265 }
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
        accent: { l: 0.78, c: 0.1, h: 255 }
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
        accentTextContrast: preset.accentTextContrast
      })
    ])
  );

  const level = preset.level ?? 'AA';
  const identifier = preset.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  // Build the schedule in memory and sweep it before emitting anything. A
  // generator that can produce an uncertifiable preset is just a slower way of
  // hand-authoring the same bug.
  const system = defineThemeSystem({
    name: preset.id,
    staticThemes: { light: built.midday, dark: built.deepNight },
    roles: {
      pairs: [
        { bg: 'background', fg: 'foreground', min: level },
        { bg: 'surface', fg: 'surfaceForeground', min: level },
        { bg: 'accent', fg: 'accentForeground', min: level }
      ]
    },
    stops: [
      {
        minute: 0,
        appearance: 'dark',
        phase: 'night',
        tokens: built.deepNight
      },
      { minute: 300, appearance: 'dark', phase: 'dawn', tokens: built.dawn },
      ...holdThenSnap({
        at: 390,
        from: built.dawn,
        to: built.sunrise,
        fromAppearance: 'dark',
        toAppearance: 'light',
        phase: 'dawn',
        nextPhase: 'sunrise'
      }),
      {
        minute: 720,
        appearance: 'light',
        phase: 'midday',
        tokens: built.midday
      },
      {
        minute: 990,
        appearance: 'light',
        phase: 'afternoon',
        tokens: built.afternoon
      },
      ...holdThenSnap({
        at: 1140,
        from: built.dusk,
        to: built.eveningNight,
        fromAppearance: 'light',
        toAppearance: 'dark',
        phase: 'dusk',
        nextPhase: 'night'
      })
    ]
  });

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

  const source = `// GENERATED by scripts/generate-presets.mjs — do not edit by hand.
// Background and accent arcs are design decisions; every other token is solved
// for a contrast target and clamped into the sRGB gamut, then certified across
// all 1,440 minutes by scripts/certify.mjs.
import { defineThemeSystem, holdThenSnap } from '../core.js';

/**
 * ${preset.name} — ${preset.description}
 */
const deepNight = {
${tokensLiteral(built.deepNight, 2)}
};

const dawn = {
${tokensLiteral(built.dawn, 2)}
};

const sunrise = {
${tokensLiteral(built.sunrise, 2)}
};

const midday = {
${tokensLiteral(built.midday, 2)}
};

const afternoon = {
${tokensLiteral(built.afternoon, 2)}
};

const dusk = {
${tokensLiteral(built.dusk, 2)}
};

const eveningNight = {
${tokensLiteral(built.eveningNight, 2)}
};

export const ${identifier} = defineThemeSystem({
  name: '${preset.id}',
  staticThemes: {
    light: midday,
    dark: deepNight
  },
  roles: {
    pairs: [
      { bg: 'background', fg: 'foreground', min: '${level}' },
      { bg: 'surface', fg: 'surfaceForeground', min: '${level}' },
      { bg: 'accent', fg: 'accentForeground', min: '${level}' }
    ]
  },
  stops: [
    { minute: 0, appearance: 'dark', phase: 'night', tokens: deepNight },
    { minute: 300, appearance: 'dark', phase: 'dawn', tokens: dawn },
    // Each appearance swap occupies a single minute, so the foreground and
    // background never cross while both are on screen.
    ...holdThenSnap({
      at: 390,
      from: dawn,
      to: sunrise,
      fromAppearance: 'dark',
      toAppearance: 'light',
      phase: 'dawn',
      nextPhase: 'sunrise'
    }),
    { minute: 720, appearance: 'light', phase: 'midday', tokens: midday },
    { minute: 990, appearance: 'light', phase: 'afternoon', tokens: afternoon },
    ...holdThenSnap({
      at: 1140,
      from: dusk,
      to: eveningNight,
      fromAppearance: 'light',
      toAppearance: 'dark',
      phase: 'dusk',
      nextPhase: 'night'
    })
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
