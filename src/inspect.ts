import {
  MINUTES_PER_DAY,
  normalizeMinute,
  resolveThemeAt,
  serializeOklch,
  type ContrastLevel,
  type NormalizedThemeStop,
  type OklchColor,
  type ThemeSnapshot,
  type ThemeSystem
} from './core.js';
import {
  contrastRatio,
  contrastThreshold,
  isOutOfSrgbGamut
} from './contrast.js';

export interface InspectedRolePair {
  readonly bg: string;
  readonly fg: string;
  readonly level: ContrastLevel;
  readonly required: number;
  readonly actual: number;
  readonly passes: boolean;
}

export interface InspectedToken {
  readonly key: string;
  readonly value: OklchColor;
  readonly css: string;
  readonly outOfGamut: boolean;
}

export interface Inspection<TPhase extends string = string> {
  readonly minute: number;
  readonly time: string;
  readonly snapshot: ThemeSnapshot<TPhase>;
  /** Stop being interpolated away from. Null for a single-stop system. */
  readonly previousStop: NormalizedThemeStop<TPhase> | null;
  /** Stop being interpolated toward. Null for a single-stop system. */
  readonly nextStop: NormalizedThemeStop<TPhase> | null;
  /** Minutes until `nextStop`. */
  readonly minutesToNextStop: number;
  readonly tokens: readonly InspectedToken[];
  readonly roles: readonly InspectedRolePair[];
  /** Role pairs failing their declared level at this minute. */
  readonly failures: readonly InspectedRolePair[];
}

function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Reports everything the resolver knows at one minute.
 *
 * Built for the moment a theme looks wrong and the question is *why* — which
 * stop pair is active, how far through the interval, what the tokens actually
 * resolved to, and whether any declared pair is currently illegible. Answering
 * that previously meant writing a throwaway script.
 */
export function inspect<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  minute: number
): Inspection<TPhase> {
  const normalizedMinute = normalizeMinute(minute);
  const snapshot = resolveThemeAt(system, normalizedMinute);
  const { previousStop, nextStop } = findStopPair(system, normalizedMinute);

  const tokens = system.tokenKeys.map((key) => {
    const value = snapshot.tokens[key];
    if (!value) {
      throw new TypeError(`Missing token "${key}".`);
    }
    return {
      key,
      value,
      css: serializeOklch(value),
      outOfGamut: isOutOfSrgbGamut(value)
    };
  });

  const roles = system.roles.map((role) => {
    const bg = snapshot.tokens[role.bg];
    const fg = snapshot.tokens[role.fg];
    const actual = bg && fg ? contrastRatio(bg, fg) : Number.NaN;
    const required = contrastThreshold(role.min);
    return {
      bg: role.bg,
      fg: role.fg,
      level: role.min,
      required,
      actual,
      passes: actual + 1e-9 >= required
    };
  });

  return {
    minute: normalizedMinute,
    time: formatMinute(normalizedMinute),
    snapshot,
    previousStop,
    nextStop,
    minutesToNextStop: nextStop
      ? distanceForward(normalizedMinute, nextStop.minute)
      : 0,
    tokens,
    roles,
    failures: roles.filter((role) => !role.passes)
  };
}

/**
 * Renders an inspection as plain text, for a console or a CI log.
 *
 * Kept separate from `inspect()` so tooling can consume the structured form
 * without paying for string building.
 */
export function formatInspection<TPhase extends string = string>(
  inspection: Inspection<TPhase>
): string {
  const lines: string[] = [];
  const { snapshot } = inspection;

  lines.push(
    `${inspection.time}  ${snapshot.phase} -> ${snapshot.nextPhase}  ` +
      `t=${snapshot.progress.toFixed(3)}  ${snapshot.appearance}` +
      (snapshot.appearance === snapshot.nextAppearance
        ? ''
        : ` -> ${snapshot.nextAppearance}`)
  );

  if (inspection.previousStop && inspection.nextStop) {
    lines.push(
      `  stops  ${formatMinute(inspection.previousStop.minute)} ` +
        `(${inspection.previousStop.phase}) -> ` +
        `${formatMinute(inspection.nextStop.minute)} ` +
        `(${inspection.nextStop.phase}), ` +
        `${inspection.minutesToNextStop} min to go`
    );
  }

  lines.push('  tokens');
  for (const token of inspection.tokens) {
    lines.push(
      `    ${token.key.padEnd(18)} ${token.css}` +
        (token.outOfGamut ? '   [OUT OF GAMUT]' : '')
    );
  }

  if (inspection.roles.length > 0) {
    lines.push('  contrast');
    for (const role of inspection.roles) {
      lines.push(
        `    ${(role.fg + ' on ' + role.bg).padEnd(34)} ` +
          `${role.actual.toFixed(2)}:1 / ${role.required}:1 ` +
          (role.passes ? 'ok' : 'FAIL')
      );
    }
  } else {
    lines.push('  contrast  (no roles declared)');
  }

  return lines.join('\n');
}

export interface ScheduleReport {
  readonly totalMinutes: number;
  readonly failingMinutes: number;
  readonly outOfGamutMinutes: number;
  readonly windows: readonly {
    readonly start: number;
    readonly end: number;
    readonly bg: string;
    readonly fg: string;
    readonly worstMinute: number;
    readonly worstRatio: number;
    readonly required: number;
  }[];
}

/**
 * Summarises a whole day, collapsing per-minute failures into windows.
 *
 * Ninety near-identical failure lines are unreadable; one window with a worst
 * case points straight at the offending stop pair.
 */
export function inspectSchedule<TPhase extends string = string>(
  system: ThemeSystem<TPhase>
): ScheduleReport {
  const windows: {
    start: number;
    end: number;
    bg: string;
    fg: string;
    worstMinute: number;
    worstRatio: number;
    required: number;
  }[] = [];
  let failingMinutes = 0;
  let outOfGamutMinutes = 0;

  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    const inspection = inspect(system, minute);
    if (inspection.tokens.some((token) => token.outOfGamut)) {
      outOfGamutMinutes += 1;
    }
    if (inspection.failures.length > 0) {
      failingMinutes += 1;
    }

    for (const failure of inspection.failures) {
      const open = windows.find(
        (window) =>
          window.end === minute - 1 &&
          window.bg === failure.bg &&
          window.fg === failure.fg
      );
      if (open) {
        open.end = minute;
        if (failure.actual < open.worstRatio) {
          open.worstRatio = failure.actual;
          open.worstMinute = minute;
        }
        continue;
      }
      windows.push({
        start: minute,
        end: minute,
        bg: failure.bg,
        fg: failure.fg,
        worstMinute: minute,
        worstRatio: failure.actual,
        required: failure.required
      });
    }
  }

  return {
    totalMinutes: MINUTES_PER_DAY,
    failingMinutes,
    outOfGamutMinutes,
    windows
  };
}

export function formatScheduleReport(report: ScheduleReport): string {
  if (report.windows.length === 0 && report.outOfGamutMinutes === 0) {
    return `PASS  ${report.totalMinutes} minutes, no contrast or gamut problems`;
  }

  const lines = [
    `FAIL  ${report.failingMinutes}/${report.totalMinutes} minutes below their declared level` +
      (report.outOfGamutMinutes > 0
        ? `, ${report.outOfGamutMinutes} with out-of-gamut tokens`
        : '')
  ];
  for (const window of report.windows) {
    lines.push(
      `  ${formatMinute(window.start)}-${formatMinute(window.end)}  ` +
        `"${window.fg}" on "${window.bg}"  ` +
        `worst ${window.worstRatio.toFixed(2)}:1 ` +
        `(needs ${window.required}:1) at ${formatMinute(window.worstMinute)}`
    );
  }
  return lines.join('\n');
}

function findStopPair<TPhase extends string>(
  system: ThemeSystem<TPhase>,
  minute: number
): {
  previousStop: NormalizedThemeStop<TPhase> | null;
  nextStop: NormalizedThemeStop<TPhase> | null;
} {
  const stops = system.stops;
  if (stops.length < 2) {
    return { previousStop: stops[0] ?? null, nextStop: null };
  }

  const exactIndex = stops.findIndex((stop) => stop.minute === minute);
  if (exactIndex !== -1) {
    return {
      previousStop: stops[exactIndex] ?? null,
      nextStop: stops[(exactIndex + 1) % stops.length] ?? null
    };
  }

  let index = stops.findIndex((stop) => stop.minute > minute);
  if (index === -1) {
    index = 0;
  }
  return {
    previousStop: stops[index === 0 ? stops.length - 1 : index - 1] ?? null,
    nextStop: stops[index] ?? null
  };
}

function distanceForward(from: number, to: number): number {
  return to >= from ? to - from : to + MINUTES_PER_DAY - from;
}
