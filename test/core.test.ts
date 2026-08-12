import { describe, expect, it } from 'vitest';
import {
  defineThemeSystem,
  normalizeMinute,
  resolveThemeAt
} from '../src/core.js';
import { createFixtureSystem } from './fixture.js';

describe('core', () => {
  it('normalizes minutes into a day', () => {
    expect(normalizeMinute(-1)).toBe(1439);
    expect(normalizeMinute(1440)).toBe(0);
    expect(normalizeMinute(1441)).toBe(1);
  });

  it('rejects mismatched token keys', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes: {
          light: { background: 'oklch(0.9 0.1 20 / 1)' },
          dark: { foreground: 'oklch(0.1 0.1 20 / 1)' }
        },
        stops: [
          {
            minute: 0,
            appearance: 'light',
            phase: 'day',
            tokens: { background: 'oklch(0.9 0.1 20 / 1)' }
          }
        ]
      })
    ).toThrow(/token key/i);
  });

  it('rejects unordered stops', () => {
    expect(() =>
      defineThemeSystem({
        staticThemes: {
          light: { background: 'oklch(0.9 0.1 20 / 1)' },
          dark: { background: 'oklch(0.1 0.1 20 / 1)' }
        },
        stops: [
          {
            minute: 60,
            appearance: 'light',
            phase: 'b',
            tokens: { background: 'oklch(0.8 0.1 20 / 1)' }
          },
          {
            minute: 0,
            appearance: 'dark',
            phase: 'a',
            tokens: { background: 'oklch(0.2 0.1 20 / 1)' }
          }
        ]
      })
    ).toThrow(/strictly increasing/i);
  });

  it('resolves exact stops and interpolates across midnight', () => {
    const system = createFixtureSystem();
    const exact = resolveThemeAt(system, 720);
    expect(exact.phase).toBe('noon');
    expect(exact.appearance).toBe('light');
    expect(exact.tokens.background.h).toBe(120);

    const wrapped = resolveThemeAt(system, 1380);
    expect(wrapped.phase).toBe('late-night');
    expect(wrapped.appearance).toBe('dark');
    expect(wrapped.minute).toBe(1380);
  });

  it('travels along the shortest hue path and keeps achromatic hue stable', () => {
    const system = defineThemeSystem({
      staticThemes: {
        light: { swatch: 'oklch(0.9 0.1 10 / 1)' },
        dark: { swatch: 'oklch(0.1 0.1 10 / 1)' }
      },
      stops: [
        {
          minute: 0,
          appearance: 'light',
          phase: 'a',
          tokens: { swatch: 'oklch(0.9 0.1 350 / 1)' }
        },
        {
          minute: 720,
          appearance: 'dark',
          phase: 'b',
          tokens: { swatch: 'oklch(0.1 0 0 / 1)' }
        }
      ]
    });

    const halfWay = resolveThemeAt(system, 360);
    expect(halfWay.tokens.swatch.h).toBe(350);
    expect(halfWay.tokens.swatch.alpha).toBe(1);
    expect(halfWay.cssText).toContain('--swatch: oklch(');
  });
});
