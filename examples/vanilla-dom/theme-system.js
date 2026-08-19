import { defineThemeSystem, holdThenSnap } from '../../dist/index.js';

// Palettes either side of each appearance swap. Both swaps go through
// holdThenSnap(), which marks the earlier stop `jumpAfter` so the resolver
// holds it and then changes instantly rather than blending across — lerping
// straight through a swap is what made this demo render invisible text around
// 06:00, and relying on whole-minute rounding to avoid it is what made the
// same bug reappear the moment anything sampled more finely.
const dawn = {
  background: 'oklch(0.2 0.04 280 / 1)',
  foreground: 'oklch(0.94 0.015 280 / 1)',
  accent: 'oklch(0.76 0.12 310 / 1)'
};

const sunrise = {
  background: 'oklch(0.97 0.015 70 / 1)',
  foreground: 'oklch(0.25 0.04 55 / 1)',
  accent: 'oklch(0.52 0.13 280 / 1)'
};

const dusk = {
  background: 'oklch(0.93 0.02 60 / 1)',
  foreground: 'oklch(0.24 0.04 55 / 1)',
  accent: 'oklch(0.52 0.13 270 / 1)'
};

const night = {
  background: 'oklch(0.22 0.05 300 / 1)',
  foreground: 'oklch(0.94 0.015 300 / 1)',
  accent: 'oklch(0.78 0.13 330 / 1)'
};

export const demoThemeSystem = defineThemeSystem({
  name: 'time-aware-theme-demo',
  staticThemes: {
    light: {
      background: 'oklch(0.98 0.008 100 / 1)',
      foreground: 'oklch(0.17 0.02 100 / 1)',
      accent: 'oklch(0.5 0.13 258 / 1)'
    },
    dark: {
      background: 'oklch(0.16 0.03 265 / 1)',
      foreground: 'oklch(0.95 0.015 265 / 1)',
      accent: 'oklch(0.78 0.12 300 / 1)'
    }
  },
  // Declaring roles turns the crossing bug into a build-time error rather than
  // something a user only notices at dusk.
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
        background: 'oklch(0.16 0.03 265 / 1)',
        foreground: 'oklch(0.95 0.015 265 / 1)',
        accent: 'oklch(0.78 0.12 300 / 1)'
      }
    },
    { minute: 300, appearance: 'dark', phase: 'dawn', tokens: dawn },
    // dark -> light
    ...holdThenSnap({
      at: 420,
      from: dawn,
      to: sunrise,
      fromAppearance: 'dark',
      toAppearance: 'light',
      phase: 'dawn',
      nextPhase: 'sunrise'
    }),
    {
      minute: 720,
      appearance: 'light',
      phase: 'midday',
      tokens: {
        background: 'oklch(0.98 0.008 100 / 1)',
        foreground: 'oklch(0.17 0.02 100 / 1)',
        accent: 'oklch(0.5 0.13 258 / 1)'
      }
    },
    {
      minute: 990,
      appearance: 'light',
      phase: 'afternoon',
      tokens: {
        background: 'oklch(0.95 0.02 80 / 1)',
        foreground: 'oklch(0.2 0.03 80 / 1)',
        accent: 'oklch(0.5 0.13 252 / 1)'
      }
    },
    // light -> dark
    ...holdThenSnap({
      at: 1140,
      from: dusk,
      to: night,
      fromAppearance: 'light',
      toAppearance: 'dark',
      phase: 'dusk',
      nextPhase: 'night'
    })
  ]
});
