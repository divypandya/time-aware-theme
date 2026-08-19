import {
  MINUTES_PER_DAY,
  type NormalizedThemeRolePair,
  type NormalizedThemeStop,
  type OklchColor,
  type ThemeAppearance,
  type ThemeRoles,
  type ThemeStopInput,
  type ThemeSystemInput,
  type ThemeTokens,
  defineThemeSystem,
  serializeOklch
} from './core.js';
import { contrastRatio, contrastThreshold } from './contrast.js';

/**
 * Works out where a theme has to change polarity, and by how little.
 *
 * Authors describe the day and which colours sit on which; they do not say
 * where light becomes dark. Two reasons that is the wrong thing to ask of a
 * person: it is easy to do asymmetrically — which is how `dusk` ended up
 * holding its label for a single minute in all four shipped presets — and
 * people reach for a far larger change than the contrast maths requires.
 * Measured against the real presets, every switch is 2.0x to 2.5x wider than
 * it needs to be.
 *
 * Runs when you build, never in a browser: it needs luminance maths that is
 * deliberately kept out of the shipped bundle. Its output is the ordinary stop
 * format, so the resolver is unchanged and hand-written schedules keep working.
 */

export interface SolveCurveStop<
  TTokens extends ThemeTokens = ThemeTokens,
  TPhase extends string = string
> {
  readonly minute: number;
  readonly phase: TPhase;
  readonly tokens: TTokens;
}

export interface SolveScheduleInput<
  TTokens extends ThemeTokens = ThemeTokens,
  TPhase extends string = string
> {
  readonly name?: string;
  readonly staticThemes: { readonly light: TTokens; readonly dark: TTokens };
  readonly roles: ThemeRoles;
  /** The day, with no `appearance` — polarity is derived from the colours. */
  readonly curve: readonly SolveCurveStop<TTokens, TPhase>[];
}

export interface SolvedSwitch {
  readonly minute: number;
  readonly phase: string;
  readonly nextPhase: string;
  /** Per token, how far it moves at the switch. Zero means a pure glide. */
  readonly jumps: Readonly<Record<string, number>>;
  readonly widestJump: number;
}

export interface SolveResult<
  TTokens extends ThemeTokens = ThemeTokens,
  TPhase extends string = string
> {
  readonly system: ThemeSystemInput<TTokens, TPhase>;
  readonly switches: readonly SolvedSwitch[];
}

type Tokens = Record<string, OklchColor>;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixHue(a: OklchColor, b: OklchColor, t: number): number | null {
  if (a.h === null && b.h === null) return null;
  if (a.h === null) return b.h;
  if (b.h === null) return a.h;
  let delta = b.h - a.h;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const mixed = a.h + delta * t;
  return ((mixed % 360) + 360) % 360;
}

function mix(a: OklchColor, b: OklchColor, t: number): OklchColor {
  const c = lerp(a.c, b.c, t);
  return {
    l: lerp(a.l, b.l, t),
    c,
    h: c <= 1e-6 ? null : mixHue(a, b, t),
    alpha: lerp(a.alpha, b.alpha, t)
  };
}

/** True when every declared pair clears its level for this token set. */
function legible(
  tokens: Tokens,
  roles: readonly NormalizedThemeRolePair[]
): boolean {
  return roles.every((role) => {
    const bg = tokens[role.bg];
    const fg = tokens[role.fg];
    if (!bg || !fg) return true;
    return contrastRatio(bg, fg) + 1e-9 >= contrastThreshold(role.min);
  });
}

/** Which side of its background each foreground sits on. */
function polarity(
  tokens: Tokens,
  roles: readonly NormalizedThemeRolePair[]
): string {
  return roles
    .map((role) => {
      const bg = tokens[role.bg];
      const fg = tokens[role.fg];
      if (!bg || !fg) return '0';
      const delta = fg.l - bg.l;
      return Math.abs(delta) <= 1e-6 ? '0' : delta > 0 ? '+' : '-';
    })
    .join('');
}

/**
 * Which token set is active, not how bright the page happens to be.
 *
 * `appearance` drives the `.dark` class, so it has to track polarity — is the
 * text lighter than what it sits on? Deriving it from background lightness
 * instead flips the class partway through a glide, while the dark-mode text is
 * still in force, so `dark:` rules and the tokens disagree for the rest of the
 * interval.
 */
function appearanceOf(
  tokens: Tokens,
  roles: readonly NormalizedThemeRolePair[]
): ThemeAppearance {
  const first = roles[0];
  if (!first) return 'light';
  const bg = tokens[first.bg];
  const fg = tokens[first.fg];
  if (!bg || !fg) return 'light';
  return fg.l > bg.l ? 'dark' : 'light';
}

function serialize(tokens: Tokens): ThemeTokens {
  return Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [key, serializeOklch(value)])
  );
}

/**
 * Splits an interval that changes polarity into a glide and a minimal switch.
 *
 * Backgrounds keep moving the whole way; foregrounds hold, then change once.
 * The switch is placed at the last minute the outgoing foreground is still
 * legible, and the backgrounds skip only the span where neither foreground
 * works — which is usually nothing, and never more than the maths demands.
 */
function solveInterval(
  from: Tokens,
  to: Tokens,
  span: number,
  roles: readonly NormalizedThemeRolePair[]
): { at: number; hold: Tokens; after: Tokens; jumps: Record<string, number> } {
  const fgKeys = new Set(roles.map((role) => role.fg));

  // Backgrounds glide; the foreground set is whichever end we are still on.
  const at = (minute: number, useOutgoing: boolean): Tokens => {
    const t = span === 0 ? 0 : minute / span;
    const out: Tokens = {};
    for (const key of Object.keys(from)) {
      const a = from[key];
      const b = to[key];
      if (!a || !b) continue;
      out[key] = fgKeys.has(key) ? (useOutgoing ? a : b) : mix(a, b, t);
    }
    return out;
  };

  let lastOutgoing = 0;
  for (let m = 0; m < span; m += 1) {
    if (legible(at(m, true), roles)) lastOutgoing = m;
    else break;
  }
  let firstIncoming = span;
  for (let m = lastOutgoing + 1; m <= span; m += 1) {
    if (legible(at(m, false), roles)) {
      firstIncoming = m;
      break;
    }
  }

  const hold = at(lastOutgoing, true);
  const after = at(firstIncoming, false);
  const jumps: Record<string, number> = {};
  for (const key of Object.keys(hold)) {
    const a = hold[key];
    const b = after[key];
    if (a && b && !fgKeys.has(key)) jumps[key] = Math.abs(a.l - b.l);
  }
  return { at: lastOutgoing, hold, after, jumps };
}

export function solveSchedule<
  TTokens extends ThemeTokens,
  TPhase extends string = string
>(input: SolveScheduleInput<TTokens, TPhase>): SolveResult<TTokens, TPhase> {
  if (input.curve.length < 2) {
    throw new TypeError('solveSchedule() requires at least two curve stops.');
  }

  // Reuse the resolver's own validation and normalisation rather than
  // re-implementing it: appearance is provisional here and recomputed below.
  const probe = defineThemeSystem({
    ...(input.name === undefined ? {} : { name: input.name }),
    staticThemes: input.staticThemes,
    roles: input.roles,
    stops: input.curve.map((stop) => ({
      minute: stop.minute,
      phase: stop.phase,
      tokens: stop.tokens,
      appearance: 'light',
      jumpAfter: true
    }))
  });
  const roles = probe.roles;
  if (roles.length === 0) {
    throw new TypeError(
      'solveSchedule() requires roles — it has nothing to solve for otherwise.'
    );
  }

  const curve: readonly NormalizedThemeStop<TPhase>[] = probe.stops;
  const stops: ThemeStopInput<TTokens, TPhase>[] = [];
  const switches: SolvedSwitch[] = [];

  for (let index = 0; index < curve.length; index += 1) {
    const current = curve[index];
    const next = curve[(index + 1) % curve.length];
    if (!current || !next) continue;

    stops.push({
      minute: current.minute,
      phase: current.phase,
      appearance: appearanceOf(current.tokens, roles),
      tokens: serialize(current.tokens) as TTokens
    });

    if (polarity(current.tokens, roles) === polarity(next.tokens, roles)) {
      continue;
    }

    const span =
      next.minute > current.minute
        ? next.minute - current.minute
        : next.minute + MINUTES_PER_DAY - current.minute;
    const solved = solveInterval(current.tokens, next.tokens, span, roles);

    const holdMinute = (current.minute + solved.at) % MINUTES_PER_DAY;
    const afterMinute = (holdMinute + 1) % MINUTES_PER_DAY;
    if (solved.at > 0) {
      stops.push({
        minute: holdMinute,
        phase: current.phase,
        appearance: appearanceOf(solved.hold, roles),
        tokens: serialize(solved.hold) as TTokens,
        jumpAfter: true
      });
    } else {
      const last = stops[stops.length - 1];
      if (last) stops[stops.length - 1] = { ...last, jumpAfter: true };
    }
    // When the switch fills the whole interval, the next curve stop already is
    // the post-switch state — inserting one on top of it would collide.
    if (afterMinute !== next.minute) {
      stops.push({
        minute: afterMinute,
        phase: next.phase,
        appearance: appearanceOf(solved.after, roles),
        tokens: serialize(solved.after) as TTokens
      });
    }

    switches.push({
      minute: holdMinute,
      phase: current.phase,
      nextPhase: next.phase,
      jumps: solved.jumps,
      widestJump: Math.max(0, ...Object.values(solved.jumps))
    });
  }

  stops.sort((a, b) => a.minute - b.minute);

  return {
    system: {
      ...(input.name ? { name: input.name } : {}),
      staticThemes: input.staticThemes,
      roles: input.roles,
      stops
    },
    switches
  };
}
