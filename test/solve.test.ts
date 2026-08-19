import { describe, expect, it } from 'vitest';
import { defineThemeSystem } from '../src/core.js';
import { solveSchedule } from '../src/solve.js';
import { PER_SECOND, findContrastViolations } from '../src/testing.js';

const roles = {
  pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' as const }]
};

const night = {
  background: 'oklch(0.15 0.03 265 / 1)',
  foreground: 'oklch(0.95 0.015 265 / 1)'
};
const day = {
  background: 'oklch(0.97 0.015 70 / 1)',
  foreground: 'oklch(0.30 0.02 70 / 1)'
};

function solve(curve: Parameters<typeof solveSchedule>[0]['curve']) {
  return solveSchedule({
    staticThemes: { light: day, dark: night },
    roles,
    curve
  });
}

describe('solveSchedule', () => {
  it('places a switch where the polarity changes', () => {
    const { switches } = solve([
      { minute: 0, phase: 'night', tokens: night },
      { minute: 720, phase: 'day', tokens: day }
    ]);
    // Two switches: night into day, and the wrap back round again.
    expect(switches).toHaveLength(2);
    for (const swap of switches) {
      expect(swap.minute).toBeGreaterThan(0);
      expect(swap.widestJump).toBeGreaterThan(0);
    }
  });

  it('produces a schedule that holds at one-second resolution', () => {
    const { system } = solve([
      { minute: 0, phase: 'night', tokens: night },
      { minute: 420, phase: 'day', tokens: day },
      { minute: 1200, phase: 'evening', tokens: day }
    ]);
    const solved = defineThemeSystem(system);
    expect(findContrastViolations(solved, { stepMinutes: PER_SECOND })).toEqual(
      []
    );
  });

  it('marks the held stop so the switch is never interpolated', () => {
    const { system } = solve([
      { minute: 0, phase: 'night', tokens: night },
      { minute: 720, phase: 'day', tokens: day }
    ]);
    const solved = defineThemeSystem(system);
    const held = solved.stops.filter((stop) => stop.jumpAfter);
    expect(held.length).toBeGreaterThan(0);
    for (const stop of held) {
      const index = solved.stops.indexOf(stop);
      const following = solved.stops[(index + 1) % solved.stops.length];
      // A declared switch is always exactly one minute wide.
      expect(following?.minute).toBe((stop.minute + 1) % 1440);
    }
  });

  it('derives appearance from polarity, not from how bright the page is', () => {
    // The background glides past mid-lightness well before the switch. If
    // appearance tracked brightness the `.dark` class would come off while the
    // light-on-dark text was still in force, so `dark:` rules and the tokens
    // would disagree for the rest of the interval.
    const { system } = solve([
      { minute: 0, phase: 'night', tokens: night },
      { minute: 720, phase: 'day', tokens: day }
    ]);
    const solved = defineThemeSystem(system);
    for (const stop of solved.stops) {
      const bg = stop.tokens.background;
      const fg = stop.tokens.foreground;
      if (!bg || !fg) continue;
      expect(stop.appearance).toBe(fg.l > bg.l ? 'dark' : 'light');
    }
  });

  it('gives every phase real time, not a single minute', () => {
    // The defect behind the shipped presets: `dusk` existed only as the snap
    // stop, so its label held for sixty seconds while every other phase ran
    // for hours. Phases now come from the curve and the switch sits inside an
    // interval, so no phase can collapse to the switch itself.
    const { system } = solve([
      { minute: 0, phase: 'night', tokens: night },
      { minute: 420, phase: 'day', tokens: day },
      { minute: 1200, phase: 'dusk', tokens: day }
    ]);
    const solved = defineThemeSystem(system);
    const held: Record<string, number> = {};
    solved.stops.forEach((stop, index) => {
      const next = solved.stops[(index + 1) % solved.stops.length];
      if (!next) return;
      const span =
        next.minute > stop.minute
          ? next.minute - stop.minute
          : next.minute + 1440 - stop.minute;
      held[stop.phase] = (held[stop.phase] ?? 0) + span;
    });
    for (const [phase, minutes] of Object.entries(held)) {
      expect(`${phase}:${minutes >= 10 ? 'ok' : 'too short'}`).toBe(
        `${phase}:ok`
      );
    }
  });

  it('leaves a curve that never changes polarity alone', () => {
    const dimmer = {
      background: 'oklch(0.22 0.03 265 / 1)',
      foreground: 'oklch(0.92 0.015 265 / 1)'
    };
    const { switches, system } = solve([
      { minute: 0, phase: 'night', tokens: night },
      { minute: 720, phase: 'late', tokens: dimmer }
    ]);
    // Dark all day: nothing to switch, so nothing is inserted.
    expect(switches).toEqual([]);
    expect(system.stops.every((stop) => stop.jumpAfter !== true)).toBe(true);
  });

  it('switches at the interval start when nothing can glide first', () => {
    // Adjacent stops with opposite polarity and no room between them: the
    // switch lands on the stop itself rather than on an inserted hold.
    const { system } = solveSchedule({
      name: 'immediate',
      staticThemes: { light: day, dark: night },
      roles,
      curve: [
        { minute: 0, phase: 'night', tokens: night },
        { minute: 1, phase: 'day', tokens: day },
        { minute: 720, phase: 'noon', tokens: day }
      ]
    });
    const solved = defineThemeSystem(system);
    expect(solved.name).toBe('immediate');
    expect(solved.stops.some((stop) => stop.jumpAfter)).toBe(true);
    expect(findContrastViolations(solved, { stepMinutes: PER_SECOND })).toEqual(
      []
    );
  });

  it('carries achromatic and wrapping hues through the glide', () => {
    const grey = {
      background: 'oklch(0.15 0 none / 1)',
      foreground: 'oklch(0.95 0 none / 1)'
    };
    const warm = {
      background: 'oklch(0.97 0.02 350 / 1)',
      foreground: 'oklch(0.30 0.02 10 / 1)'
    };
    const { system } = solveSchedule({
      staticThemes: { light: warm, dark: grey },
      roles,
      // 350deg to 10deg takes the short way across 0, and one end is grey with
      // no hue at all.
      curve: [
        { minute: 0, phase: 'night', tokens: grey },
        { minute: 720, phase: 'day', tokens: warm }
      ]
    });
    const solved = defineThemeSystem(system);
    for (const stop of solved.stops) {
      const bg = stop.tokens.background;
      expect(bg && Number.isFinite(bg.l)).toBe(true);
      if (bg && bg.c > 0) expect(bg.h).not.toBeNull();
    }
    expect(findContrastViolations(solved, { stepMinutes: PER_SECOND })).toEqual(
      []
    );
  });

  it('refuses input it cannot solve', () => {
    expect(() => solve([{ minute: 0, phase: 'night', tokens: night }])).toThrow(
      /at least two/
    );

    expect(() =>
      solveSchedule({
        staticThemes: { light: day, dark: night },
        roles: { pairs: [] },
        curve: [
          { minute: 0, phase: 'night', tokens: night },
          { minute: 720, phase: 'day', tokens: day }
        ]
      })
    ).toThrow(/requires roles/);
  });
});
