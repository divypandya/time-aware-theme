import { defineThemeSystem } from '../dist/index.js';

export function createFixtureSystem() {
  return defineThemeSystem({
    name: 'validation-fixture',
    staticThemes: {
      light: {
        background: 'oklch(0.98 0.01 250 / 1)',
        foreground: 'oklch(0.17 0.03 250 / 1)',
        accent: 'oklch(0.66 0.14 260 / 1)'
      },
      dark: {
        background: 'oklch(0.13 0.02 250 / 1)',
        foreground: 'oklch(0.96 0.01 250 / 1)',
        accent: 'oklch(0.76 0.12 260 / 1)'
      }
    },
    stops: [
      {
        minute: 0,
        appearance: 'dark',
        phase: 'night',
        tokens: {
          background: 'oklch(0.14 0.02 260 / 1)',
          foreground: 'oklch(0.96 0.01 260 / 1)',
          accent: 'oklch(0.74 0.12 300 / 1)'
        }
      },
      {
        minute: 180,
        appearance: 'dark',
        phase: 'pre-dawn',
        tokens: {
          background: 'oklch(0.18 0.03 265 / 1)',
          foreground: 'oklch(0.95 0.01 265 / 1)',
          accent: 'oklch(0.70 0.13 310 / 1)'
        }
      },
      {
        minute: 360,
        appearance: 'light',
        phase: 'dawn',
        tokens: {
          background: 'oklch(0.92 0.02 75 / 1)',
          foreground: 'oklch(0.18 0.03 75 / 1)',
          accent: 'oklch(0.68 0.16 55 / 1)'
        }
      },
      {
        minute: 540,
        appearance: 'light',
        phase: 'morning',
        tokens: {
          background: 'oklch(0.96 0.01 100 / 1)',
          foreground: 'oklch(0.20 0.03 100 / 1)',
          accent: 'oklch(0.64 0.14 70 / 1)'
        }
      },
      {
        minute: 720,
        appearance: 'light',
        phase: 'noon',
        tokens: {
          background: 'oklch(0.99 0.01 120 / 1)',
          foreground: 'oklch(0.16 0.03 120 / 1)',
          accent: 'oklch(0.68 0.14 90 / 1)'
        }
      },
      {
        minute: 900,
        appearance: 'light',
        phase: 'afternoon',
        tokens: {
          background: 'oklch(0.95 0.01 160 / 1)',
          foreground: 'oklch(0.18 0.03 160 / 1)',
          accent: 'oklch(0.66 0.13 145 / 1)'
        }
      },
      {
        minute: 1080,
        appearance: 'dark',
        phase: 'sunset',
        tokens: {
          background: 'oklch(0.22 0.04 250 / 1)',
          foreground: 'oklch(0.94 0.01 250 / 1)',
          accent: 'oklch(0.72 0.16 25 / 1)'
        }
      },
      {
        minute: 1320,
        appearance: 'dark',
        phase: 'late-night',
        tokens: {
          background: 'oklch(0.16 0.02 285 / 1)',
          foreground: 'oklch(0.96 0.01 285 / 1)',
          accent: 'oklch(0.75 0.11 340 / 1)'
        }
      }
    ]
  });
}

