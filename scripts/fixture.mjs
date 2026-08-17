import { defineThemeSystem, holdThenSnap } from '../dist/index.js';

// Token sets either side of each appearance swap. The swap itself is expanded
// by holdThenSnap() into a hold stop and a snap stop one minute later, so the
// foreground/background crossing has no sampleable interior and contrast never
// collapses. Lerping straight through a swap is what produced 166 sub-AA
// minutes (worst 1.00:1) in the previous revision of this fixture.
// Accent hues stay in blue/violet through the light phases. sRGB has no dark
// yellows — max chroma at L=0.50 is ~0.10 around hue 90 but ~0.14 at hue 250 —
// so sweeping a low-lightness accent through yellow leaves the gamut. The
// certification gate catches this; keeping the arc cool avoids it by design.
const preDawn = {
  background: 'oklch(0.14 0.03 265 / 1)',
  foreground: 'oklch(0.96 0.01 265 / 1)',
  accent: 'oklch(0.76 0.12 310 / 1)'
};

const dawn = {
  background: 'oklch(0.97 0.015 75 / 1)',
  foreground: 'oklch(0.25 0.05 55 / 1)',
  accent: 'oklch(0.52 0.13 280 / 1)'
};

const dusk = {
  background: 'oklch(0.93 0.02 60 / 1)',
  foreground: 'oklch(0.24 0.04 55 / 1)',
  accent: 'oklch(0.52 0.13 270 / 1)'
};

const sunset = {
  background: 'oklch(0.22 0.04 250 / 1)',
  foreground: 'oklch(0.94 0.01 250 / 1)',
  accent: 'oklch(0.78 0.12 30 / 1)'
};

export function createFixtureSystem() {
  return defineThemeSystem({
    name: 'validation-fixture',
    staticThemes: {
      light: {
        background: 'oklch(0.97 0.01 250 / 1)',
        foreground: 'oklch(0.17 0.03 250 / 1)',
        accent: 'oklch(0.52 0.13 260 / 1)'
      },
      dark: {
        background: 'oklch(0.13 0.02 250 / 1)',
        foreground: 'oklch(0.96 0.01 250 / 1)',
        accent: 'oklch(0.78 0.11 260 / 1)'
      }
    },
    roles: {
      pairs: [
        { bg: 'background', fg: 'foreground', min: 'AA' },
        { bg: 'background', fg: 'accent', min: 'AA-large' }
      ]
    },
    stops: [
      {
        minute: 0,
        appearance: 'dark',
        phase: 'night',
        tokens: {
          background: 'oklch(0.14 0.02 260 / 1)',
          foreground: 'oklch(0.96 0.01 260 / 1)',
          accent: 'oklch(0.78 0.12 300 / 1)'
        }
      },
      {
        minute: 180,
        appearance: 'dark',
        phase: 'pre-dawn',
        tokens: preDawn
      },
      // dark -> light
      ...holdThenSnap({
        at: 360,
        from: preDawn,
        to: dawn,
        fromAppearance: 'dark',
        toAppearance: 'light',
        phase: 'pre-dawn',
        nextPhase: 'dawn'
      }),
      {
        minute: 540,
        appearance: 'light',
        phase: 'morning',
        tokens: {
          background: 'oklch(0.96 0.01 100 / 1)',
          foreground: 'oklch(0.22 0.03 100 / 1)',
          accent: 'oklch(0.51 0.13 268 / 1)'
        }
      },
      {
        minute: 720,
        appearance: 'light',
        phase: 'noon',
        tokens: {
          background: 'oklch(0.98 0.01 120 / 1)',
          foreground: 'oklch(0.16 0.03 120 / 1)',
          accent: 'oklch(0.50 0.13 258 / 1)'
        }
      },
      {
        minute: 900,
        appearance: 'light',
        phase: 'afternoon',
        tokens: {
          background: 'oklch(0.95 0.01 160 / 1)',
          foreground: 'oklch(0.18 0.03 160 / 1)',
          accent: 'oklch(0.50 0.13 252 / 1)'
        }
      },
      // light -> dark
      ...holdThenSnap({
        at: 1080,
        from: dusk,
        to: sunset,
        fromAppearance: 'light',
        toAppearance: 'dark',
        phase: 'dusk',
        nextPhase: 'sunset'
      }),
      {
        minute: 1320,
        appearance: 'dark',
        phase: 'late-night',
        tokens: {
          background: 'oklch(0.16 0.02 285 / 1)',
          foreground: 'oklch(0.96 0.01 285 / 1)',
          accent: 'oklch(0.80 0.11 340 / 1)'
        }
      }
    ]
  });
}
