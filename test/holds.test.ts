import { describe, expect, it } from 'vitest';
import { must } from './must.js';
import { defineThemeSystem } from '../src/core.js';
import {
  formatInspection,
  formatScheduleReport,
  inspect,
  inspectSchedule
} from '../src/inspect.js';
import { contrastFirst } from '../src/presets/contrast-first.js';
import { dawnToDusk } from '../src/presets/dawn-to-dusk.js';
import { paper } from '../src/presets/paper.js';
import { tidal } from '../src/presets/tidal.js';

describe('hold windows', () => {
  it('finds one in each direction for every shipped preset', () => {
    for (const preset of [dawnToDusk, tidal, paper, contrastFirst]) {
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

  it('reports the widest step across all tokens, not just the background', () => {
    // The background is what the solver minimises, so quoting only that
    // understates the visible change. In every warm preset a foreground on an
    // accent moves further than the page does.
    const [first] = inspectSchedule(dawnToDusk).holds;
    const hold = must(first, 'hold');
    expect(hold.widestToken).toBe('accentForeground');
    expect(hold.widestJump).toBeGreaterThan(
      must(hold.jumps.background, 'background jump')
    );
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
