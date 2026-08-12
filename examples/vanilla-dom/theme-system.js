import { defineThemeSystem } from '../../dist/index.js';

export const demoThemeSystem = defineThemeSystem({
  name: 'time-aware-theme-demo',
  staticThemes: {
    light: {
      background: 'oklch(0.99 0.01 100 / 1)',
      foreground: 'oklch(0.15 0.02 100 / 1)',
      accent: 'oklch(0.65 0.16 250 / 1)'
    },
    dark: {
      background: 'oklch(0.16 0.03 265 / 1)',
      foreground: 'oklch(0.95 0.02 265 / 1)',
      accent: 'oklch(0.72 0.15 300 / 1)'
    }
  },
  stops: [
    {
      minute: 0,
      appearance: 'dark',
      phase: 'night',
      tokens: {
        background: 'oklch(0.16 0.03 265 / 1)',
        foreground: 'oklch(0.95 0.02 265 / 1)',
        accent: 'oklch(0.72 0.15 300 / 1)'
      }
    },
    {
      minute: 300,
      appearance: 'dark',
      phase: 'dawn',
      tokens: {
        background: 'oklch(0.2 0.04 280 / 1)',
        foreground: 'oklch(0.96 0.02 280 / 1)',
        accent: 'oklch(0.7 0.16 320 / 1)'
      }
    },
    {
      minute: 420,
      appearance: 'light',
      phase: 'sunrise',
      tokens: {
        background: 'oklch(0.97 0.03 70 / 1)',
        foreground: 'oklch(0.18 0.03 70 / 1)',
        accent: 'oklch(0.72 0.18 40 / 1)'
      }
    },
    {
      minute: 720,
      appearance: 'light',
      phase: 'midday',
      tokens: {
        background: 'oklch(0.99 0.01 100 / 1)',
        foreground: 'oklch(0.15 0.02 100 / 1)',
        accent: 'oklch(0.65 0.16 250 / 1)'
      }
    },
    {
      minute: 990,
      appearance: 'light',
      phase: 'afternoon',
      tokens: {
        background: 'oklch(0.95 0.03 80 / 1)',
        foreground: 'oklch(0.2 0.03 80 / 1)',
        accent: 'oklch(0.68 0.18 50 / 1)'
      }
    },
    {
      minute: 1140,
      appearance: 'dark',
      phase: 'dusk',
      tokens: {
        background: 'oklch(0.22 0.05 300 / 1)',
        foreground: 'oklch(0.95 0.02 300 / 1)',
        accent: 'oklch(0.74 0.16 330 / 1)'
      }
    }
  ]
});
