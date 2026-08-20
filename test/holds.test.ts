import { describe, expect, it } from 'vitest';
import { must } from './must.js';
import { defineThemeSystem } from '../src/core.js';
import {
  formatInspection,
  formatScheduleReport,
  inspect,
  inspectSchedule
} from '../src/inspect.js';
import { blossom } from '../src/presets/blossom.js';
import { contrastFirst } from '../src/presets/contrast-first.js';
import { dawnToDusk } from '../src/presets/dawn-to-dusk.js';
import { ember } from '../src/presets/ember.js';
import { forest } from '../src/presets/forest.js';
import { meridian } from '../src/presets/meridian.js';
import { nocturne } from '../src/presets/nocturne.js';
import { paper } from '../src/presets/paper.js';
import { slate } from '../src/presets/slate.js';
import { tidal } from '../src/presets/tidal.js';

const shipped = [
  dawnToDusk,
  tidal,
  paper,
  contrastFirst,
  nocturne,
  ember,
  forest,
  meridian,
  blossom,
  slate
];

describe('hold windows', () => {
  it('finds one in each direction for every shipped preset', () => {
    for (const preset of shipped) {
      const { holds } = inspectSchedule(preset);
      expect(`${preset.name}: ${holds.length}`).toBe(`${preset.name}: 2`);
      for (const hold of holds) {
        expect(hold.flipsAppearance).toBe(true);
        expect(hold.minutes).toBe(1);
        expect(hold.jumpAt).toBe(hold.start + 1);
        expect(hold.widestJump).toBeGreaterThan(0);
        expect(hold.jumps[hold.widestToken]).toBe(hold.widestJump);
      }
      // One into light, one back into dark, not two of the same.
      expect(new Set(holds.map((hold) => hold.nextPhase)).size).toBeGreaterThan(
        0
      );
    }
  });

  it('never moves an accent pair, in any shipped preset', () => {
    // The guarantee behind fixed-polarity accents. In 0.3.0 accentForeground
    // was the single largest jump in every AA preset - 0.659 in lightness,
    // larger than the page itself - because a mid-lightness accent let its
    // text pick a different side in different phases. A primary button
    // inverting at dusk is not something anyone asked for.
    // Not exactly zero: a hold freezes the tokens for a minute, so whatever
    // the accent would have glided during that minute is counted here too.
    // 0.002 is that glide; 0.659 was a flip. The bar separates the two.
    const GLIDE = 0.01;
    for (const preset of shipped) {
      for (const hold of inspectSchedule(preset).holds) {
        for (const token of ['accent', 'accentForeground'] as const) {
          const moved = must(hold.jumps[token], `${token} jump`);
          const verdict = moved < GLIDE ? 'glides' : moved.toFixed(3);
          expect(`${preset.name ?? '?'} ${token} ${verdict}`).toBe(
            `${preset.name ?? '?'} ${token} glides`
          );
        }
      }
    }
  });

  it('keeps the page itself gliding through the switch', () => {
    // The point of 0.4.0. The text still flips - it has to, since gliding it
    // would pass through mid-grey on a mid-grey page - but the background now
    // crosses continuously instead of lurching half its daily range.
    for (const preset of shipped) {
      // AAA cannot reach a small step: the gap closes only when the required
      // ratio squared is at most 21, and 7^2 is 49. That is a fact about the
      // ratio, not a shortfall in this preset.
      const budget = preset.name === 'contrast-first' ? 0.3 : 0.05;
      for (const hold of inspectSchedule(preset).holds) {
        const background = must(hold.jumps.background, 'background jump');
        expect(
          `${preset.name ?? '?'} ${background < budget ? 'ok' : background.toFixed(3)}`
        ).toBe(`${preset.name ?? '?'} ok`);
      }
    }
  });

  it('shows up in the report even when nothing is wrong', () => {
    const text = formatScheduleReport(inspectSchedule(dawnToDusk));
    expect(text).toMatch(/^PASS/);
    expect(text).toContain('holds (2)');
    expect(text).toContain('appearance flips');
  });

  it('shows up alongside failures too', () => {
    const broken = defineThemeSystem({
      staticThemes: {
        light: {
          background: 'oklch(0.97 0.01 90 / 1)',
          foreground: 'oklch(0.3 0.02 90 / 1)'
        },
        dark: {
          background: 'oklch(0.15 0.03 265 / 1)',
          foreground: 'oklch(0.95 0.02 265 / 1)'
        }
      },
      roles: { pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' }] },
      stops: [
        {
          minute: 0,
          appearance: 'light',
          phase: 'a',
          tokens: {
            background: 'oklch(0.6 0.02 90 / 1)',
            foreground: 'oklch(0.5 0.02 90 / 1)'
          },
          jumpAfter: true
        },
        {
          minute: 720,
          appearance: 'light',
          phase: 'b',
          tokens: {
            background: 'oklch(0.6 0.02 90 / 1)',
            foreground: 'oklch(0.5 0.02 90 / 1)'
          }
        }
      ]
    });
    const text = formatScheduleReport(inspectSchedule(broken));
    expect(text).toMatch(/^FAIL/);
    expect(text).toContain('holds (1)');
    // A hold that changes nothing and flips nothing is still worth naming:
    // twelve hours of frozen tokens is almost always a mistake.
    expect(text).toContain('same appearance');
    expect(must(inspectSchedule(broken).holds[0], 'hold').minutes).toBe(720);
  });

  it('reports none when a schedule only glides', () => {
    const gliding = defineThemeSystem({
      staticThemes: {
        light: {
          background: 'oklch(0.97 0.01 90 / 1)',
          foreground: 'oklch(0.3 0.02 90 / 1)'
        },
        dark: {
          background: 'oklch(0.15 0.03 265 / 1)',
          foreground: 'oklch(0.95 0.02 265 / 1)'
        }
      },
      roles: { pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' }] },
      stops: [
        {
          minute: 0,
          appearance: 'dark',
          phase: 'night',
          tokens: {
            background: 'oklch(0.15 0.03 265 / 1)',
            foreground: 'oklch(0.95 0.02 265 / 1)'
          }
        },
        {
          minute: 720,
          appearance: 'dark',
          phase: 'late',
          tokens: {
            background: 'oklch(0.22 0.03 265 / 1)',
            foreground: 'oklch(0.9 0.02 265 / 1)'
          }
        }
      ]
    });
    const report = inspectSchedule(gliding);
    expect(report.holds).toEqual([]);
    expect(formatScheduleReport(report)).not.toContain('holds');
  });

  it('explains why a single minute looks frozen', () => {
    const { start } = must(inspectSchedule(dawnToDusk).holds[0], 'hold');
    const text = formatInspection(inspect(dawnToDusk, start));
    expect(text).toContain('holding');
    expect(text).toContain('they change instantly');
    // And the minute before it is an ordinary gliding one.
    expect(formatInspection(inspect(dawnToDusk, start - 1))).not.toContain(
      'holding'
    );
  });
});
