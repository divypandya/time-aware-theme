import {
  MINUTES_PER_DAY,
  type ContrastLevel,
  type NormalizedThemeRolePair,
  type NormalizedThemeStop,
  type OklchColor,
  type OklchInput,
  type ThemeAppearance,
  type ThemeRolePair,
  type ThemeRoles,
  type ThemeStopInput,
  type ThemeSystem,
  type ThemeSystemInput,
  type ThemeTokens,
  defineThemeSystem,
  parseOklch,
  serializeOklch
} from './core.js';
import {
  GAMUT_CHROMA_SAFETY,
  clampChromaToGamut,
  contrastRatio,
  contrastThreshold
} from './contrast.js';

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
        // Keeps the *current* phase, not the one being moved toward. The
        // switch is a colour event; the phase is how the author labelled the
        // day, and the two are independent. Advancing the label at the switch
        // collapses whichever phase the switch happens to land near — at AAA
        // the switch lands minutes into the interval, which reduced `dawn` to
        // six minutes. That is the one-minute-dusk defect wearing a new hat.
        phase: current.phase,
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

/**
 * A token added to an existing theme.
 *
 * Either an arc you supply, which rides the preset's own day curve, or a
 * foreground pinned to another token at a contrast level, which is solved for
 * you at every stop.
 */
export type ExtendedToken =
  | {
      /** Value while the theme is in its light polarity. */
      readonly light: OklchInput;
      /** Value while it is in its dark polarity. */
      readonly dark: OklchInput;
      /**
       * Opt out of needing a role. Set only for colours nothing is read
       * against — a shadow, a gradient midpoint. Explicit because the whole
       * point of this helper is that it cannot quietly add uncertified text.
       */
      readonly decorative?: boolean;
    }
  | {
      /** Token this one is read against. Its role pair is declared for you. */
      readonly on: string;
      readonly min?: ContrastLevel;
      /** Defaults to a low chroma carrying the background's hue. */
      readonly chroma?: number;
      readonly hue?: number;
    };

export interface ExtendPresetInput {
  readonly name?: string;
  readonly tokens: Readonly<Record<string, ExtendedToken>>;
  /** Pairs to certify. Required for any supplied arc that is read against. */
  readonly roles?: ThemeRoles;
  /**
   * Token whose lightness arc the new colours follow. Defaults to the first
   * declared pair's background — the preset's own sense of time of day.
   */
  readonly anchor?: string;
}

/** Margins tried in turn, since a per-stop solve can still dip between stops. */
const EXTEND_MARGINS = [1, 1.02, 1.05, 1.1, 1.2, 1.35];

function isSolvedToken(
  spec: ExtendedToken
): spec is Extract<ExtendedToken, { on: string }> {
  return 'on' in spec;
}

/**
 * Adds tokens to a preset without breaking what the preset certified.
 *
 * The alternative people reach for is spreading the preset, editing the token
 * maps, and calling `defineThemeSystem` again, which works, silently drops the
 * new colours outside every guarantee the preset shipped with, and has to be
 * redone at each of eleven stops. Worse, a new foreground has its own
 * crossing, and if it lands anywhere other than the preset's declared switch
 * it is a fresh undeclared discontinuity in a schedule that was certified
 * without it.
 *
 * So: arcs follow the anchor's curve, solved foregrounds take the polarity of
 * the stop they sit in, which puts their crossing exactly on the existing hold
 * and nowhere else, and the result is verified before it is returned.
 *
 * Build-time, like the rest of this module. Calling it per request works but
 * pays for a bisection at every stop.
 */
export function extendPreset<TPhase extends string = string>(
  preset: ThemeSystem<TPhase>,
  input: ExtendPresetInput
): ThemeSystem<TPhase> {
  const newKeys = Object.keys(input.tokens);
  if (newKeys.length === 0) {
    throw new TypeError('extendPreset() needs at least one token.');
  }
  for (const key of newKeys) {
    if (preset.tokenKeys.includes(key)) {
      throw new TypeError(
        `extendPreset() cannot redefine "${key}", which the preset already ` +
          'has. Extending adds tokens; changing one means authoring the ' +
          'schedule yourself.'
      );
    }
  }

  const anchorKey = input.anchor ?? preset.roles[0]?.bg;
  if (!anchorKey) {
    throw new TypeError(
      'extendPreset() needs an anchor token to follow. The preset declares no ' +
        'roles, so pass `anchor` explicitly.'
    );
  }
  const anchorLight = preset.staticThemes.light[anchorKey];
  const anchorDark = preset.staticThemes.dark[anchorKey];
  if (!anchorLight || !anchorDark) {
    throw new TypeError(
      `extendPreset() anchor "${anchorKey}" is not a token of this preset.`
    );
  }

  // Pairs declared for us by every `on` token, plus whatever the caller added.
  const declaredPairs: ThemeRolePair[] = [
    ...preset.roles.map((role) => ({ ...role })),
    ...newKeys.flatMap((key) => {
      const spec = input.tokens[key];
      return spec && isSolvedToken(spec)
        ? [{ bg: spec.on, fg: key, min: spec.min ?? 'AA' }]
        : [];
    }),
    ...(input.roles?.pairs ?? []).map((pair) => ({ ...pair }))
  ];

  // The enforcement: an arc that nothing certifies is refused, not warned
  // about. A preset that says "certified" has to stay true of every token in
  // it, including the ones added after it shipped.
  const covered = new Set(declaredPairs.flatMap((pair) => [pair.bg, pair.fg]));
  for (const key of newKeys) {
    const spec = input.tokens[key];
    if (!spec || isSolvedToken(spec) || spec.decorative === true) {
      continue;
    }
    if (!covered.has(key)) {
      throw new TypeError(
        `extendPreset() token "${key}" has no role. Add it to \`roles.pairs\` ` +
          `so it is certified alongside the preset's own colours, or mark it ` +
          '`decorative: true` if nothing is ever read against it.'
      );
    }
  }

  const span = anchorLight.l - anchorDark.l;
  /** Where this stop sits on the preset's own dark-to-light arc, 0..1. */
  const progressOf = (tokens: Readonly<Record<string, OklchColor>>): number => {
    const anchor = tokens[anchorKey];
    if (!anchor || Math.abs(span) <= 1e-6) {
      return 0;
    }
    return Math.min(1, Math.max(0, (anchor.l - anchorDark.l) / span));
  };

  let lastFailure: { message: string; role: NormalizedThemeRolePair } | null =
    null;
  let lastUnreachable: readonly UnreachablePair[] = [];
  for (const margin of EXTEND_MARGINS) {
    const unreachable: UnreachablePair[] = [];
    const built = buildExtension(
      preset,
      input,
      { declaredPairs, progressOf, margin },
      unreachable
    );
    const failure = verifyExtension(built, preset);
    if (!failure) {
      return built;
    }
    lastFailure = failure;
    lastUnreachable = unreachable;
  }

  throw new Error(
    'extendPreset() could not certify the tokens it was given.\n' +
      `  ${lastFailure?.message ?? ''}\n` +
      adviseOnFailure(input, lastFailure?.role, lastUnreachable)
  );
}

/**
 * Turns a failure into something the caller can act on.
 *
 * Three genuinely different situations hide behind one shortfall, and the
 * useful next step differs in each: a colour that was checked and not
 * adjusted, a background sitting in the band where neither black nor white
 * works, or a target that is merely a little too high.
 */
function adviseOnFailure(
  input: ExtendPresetInput,
  role: NormalizedThemeRolePair | undefined,
  unreachable: readonly UnreachablePair[]
): string {
  const spec = role ? input.tokens[role.fg] : undefined;

  // A supplied arc was never adjusted, deliberately. Quietly repainting
  // someone's brand colour to reach a ratio would be a worse outcome than
  // telling them it does not reach one.
  if (spec && !isSolvedToken(spec)) {
    return (
      `  "${role?.fg}" is an arc you supplied, so it was checked rather than ` +
      `adjusted. Move its \`light\`/\`dark\` values further from "${role?.bg}", ` +
      'lower the level on that pair, or pin it with `{ on: ... }` and let it ' +
      'be solved.'
    );
  }

  const stuck = unreachable.find((entry) => entry.fg === role?.fg);
  if (stuck) {
    const where = (best: { ratio: number; minute: number | null }) =>
      `${best.ratio.toFixed(2)}:1` +
      (best.minute === null ? '' : ` at ${formatMinute(best.minute)}`);
    return (
      `  No text colour works: "${stuck.bg}" spans L ` +
      `${stuck.lowestL.toFixed(3)}..${stuck.highestL.toFixed(3)} while the ` +
      `theme is ${stuck.appearance}, which straddles the band where neither ` +
      `black nor white clears ${stuck.level}. White bottoms out at ` +
      `${where(stuck.bestLight)}; black bottoms out at ` +
      `${where(stuck.bestDark)}.\n` +
      `  Narrow that arc, or move it away from mid-lightness. This is not a ` +
      `limit of the solver: no colour placed on "${stuck.bg}" is legible at ` +
      'both ends of that span.'
    );
  }

  return (
    '  Tried margins up to ' +
    `${EXTEND_MARGINS[EXTEND_MARGINS.length - 1]}x the required ratio. The ` +
    'level is likely too high for where its background sits at that moment: ' +
    'try a lower `min`, or pin the token to a surface that stays further ' +
    'from mid-grey.'
  );
}

function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = Math.round(minute % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

interface Frame {
  readonly appearance: ThemeAppearance;
  /** Null for the two static themes, which sit outside the day. */
  readonly minute: number | null;
  readonly progress: number;
  readonly tokens: Tokens;
}

/**
 * A solved token whose background is too close to mid-lightness for either
 * black or white to reach the target everywhere in one polarity region.
 */
interface UnreachablePair {
  readonly fg: string;
  readonly bg: string;
  readonly appearance: ThemeAppearance;
  readonly level: ContrastLevel;
  readonly bestLight: { ratio: number; minute: number | null };
  readonly bestDark: { ratio: number; minute: number | null };
  readonly lowestL: number;
  readonly highestL: number;
}

function buildExtension<TPhase extends string>(
  preset: ThemeSystem<TPhase>,
  input: ExtendPresetInput,
  context: {
    declaredPairs: readonly ThemeRolePair[];
    progressOf: (tokens: Readonly<Record<string, OklchColor>>) => number;
    margin: number;
  },
  unreachable: UnreachablePair[]
): ThemeSystem<TPhase> {
  // Every moment the new tokens need a value: each stop, plus the two static
  // themes, which are what `mode: 'light'` and `mode: 'dark'` serve and so
  // have to be extended too or the new tokens vanish when a user pins the mode.
  const frames: Frame[] = [
    ...preset.stops.map((stop) => ({
      appearance: stop.appearance,
      minute: stop.minute,
      progress: context.progressOf(stop.tokens),
      tokens: { ...stop.tokens }
    })),
    {
      appearance: 'light' as const,
      minute: null,
      progress: 1,
      tokens: { ...preset.staticThemes.light }
    },
    {
      appearance: 'dark' as const,
      minute: null,
      progress: 0,
      tokens: { ...preset.staticThemes.dark }
    }
  ];

  // One token at a time, across the whole day, because a solved token needs
  // its background to already exist — including when that background is
  // itself a token being added here.
  for (const key of Object.keys(input.tokens)) {
    const spec = input.tokens[key];
    if (!spec) continue;
    if (!isSolvedToken(spec)) {
      const dark = parseOklch(spec.dark, `${key}.dark`);
      const light = parseOklch(spec.light, `${key}.light`);
      for (const frame of frames) {
        frame.tokens[key] = mix(dark, light, frame.progress);
      }
      continue;
    }
    fillSolvedToken(frames, key, spec, context.margin, unreachable);
  }

  const stopFrames = frames.slice(0, preset.stops.length);
  const lightFrame = frames[frames.length - 2];
  const darkFrame = frames[frames.length - 1];
  const name = input.name ?? preset.name;

  return defineThemeSystem<ThemeTokens, TPhase>({
    ...(name === undefined ? {} : { name }),
    staticThemes: {
      light: serialize(lightFrame?.tokens ?? {}),
      dark: serialize(darkFrame?.tokens ?? {})
    },
    roles: { pairs: context.declaredPairs },
    stops: preset.stops.map((stop, index) => ({
      minute: stop.minute,
      appearance: stop.appearance,
      phase: stop.phase,
      jumpAfter: stop.jumpAfter,
      tokens: serialize(stopFrames[index]?.tokens ?? {})
    }))
  });
}

/**
 * Solves one foreground across the day, one direction per polarity region.
 *
 * The direction is chosen once for all the light-appearance frames and once
 * for all the dark ones, never per stop. That is the load-bearing part: a
 * token free to pick a side stop by stop would cross somewhere in the middle
 * of an interval, opening an undeclared discontinuity in a schedule that was
 * certified without one. Fixed per region, the only place it can change sides
 * is the boundary between regions, which is exactly where the preset already
 * declares a hold.
 *
 * Matching the page is preferred but not required. An accent pair genuinely
 * runs the other way — the shipped presets put dark text on a light violet
 * accent while the page is in dark mode — so a rule that forced agreement
 * with `appearance` would refuse to solve the most common thing anyone adds.
 */
function fillSolvedToken(
  frames: readonly Frame[],
  key: string,
  spec: Extract<ExtendedToken, { on: string }>,
  margin: number,
  unreachable: UnreachablePair[]
): void {
  const target = contrastThreshold(spec.min ?? 'AA') * margin;

  const shapeFor = (against: OklchColor) => (l: number) =>
    clampChromaToGamut(
      { l, c: spec.chroma ?? 0.015, h: spec.hue ?? against.h, alpha: 1 },
      GAMUT_CHROMA_SAFETY
    );

  const backgroundAt = (frame: Frame): OklchColor => {
    const against = frame.tokens[spec.on];
    if (!against) {
      throw new TypeError(
        `extendPreset() token "${key}" is read against "${spec.on}", which is ` +
          'not a token of this preset. If "' +
          spec.on +
          '" is also being added here, list it before "' +
          key +
          '" so it exists first.'
      );
    }
    return against;
  };

  for (const appearance of ['light', 'dark'] as const) {
    const region = frames.filter((frame) => frame.appearance === appearance);
    if (region.length === 0) continue;

    // Dark page prefers light text, light page prefers dark text.
    const preferred = appearance === 'dark';
    // The weakest moment in each direction. Black and white are the extremes,
    // so this is the best this pair could ever do there.
    const weakest = (lighter: boolean) =>
      region.reduce(
        (worst, frame) => {
          const against = backgroundAt(frame);
          const ratio = contrastRatio(
            against,
            shapeFor(against)(lighter ? 1 : 0)
          );
          return ratio < worst.ratio ? { ratio, minute: frame.minute } : worst;
        },
        { ratio: Number.POSITIVE_INFINITY, minute: null as number | null }
      );

    const bestLight = weakest(true);
    const bestDark = weakest(false);
    const lightWorks = bestLight.ratio + 1e-9 >= target;
    const darkWorks = bestDark.ratio + 1e-9 >= target;

    // Neither extreme reaches the target everywhere in this region, so no
    // choice of direction can. Recorded rather than thrown from here: the
    // margin loop upstream may yet find a lower target that works, and a
    // diagnostic is only worth reporting once every attempt has failed.
    if (!lightWorks && !darkWorks) {
      const lightnesses = region.map((frame) => backgroundAt(frame).l);
      unreachable.push({
        fg: key,
        bg: spec.on,
        appearance,
        level: spec.min ?? 'AA',
        bestLight,
        bestDark,
        lowestL: Math.min(...lightnesses),
        highestL: Math.max(...lightnesses)
      });
    }

    // Prefer agreeing with the page, take the other side if that is what
    // works, and when nothing works go with whichever gets closest so the
    // reported failure is the real shortfall rather than an arbitrary one.
    const lighter =
      preferred && lightWorks
        ? true
        : !preferred && darkWorks
          ? false
          : lightWorks
            ? true
            : darkWorks
              ? false
              : bestLight.ratio >= bestDark.ratio;

    for (const frame of region) {
      const against = backgroundAt(frame);
      frame.tokens[key] = solveAgainst(
        against,
        shapeFor(against),
        target,
        lighter
      );
    }
  }
}

/** Nearest lightness in one direction that clears `target` against `against`. */
function solveAgainst(
  against: OklchColor,
  shape: (l: number) => OklchColor,
  target: number,
  lighter: boolean
): OklchColor {
  let near = against.l;
  let far = lighter ? 1 : 0;
  if (contrastRatio(against, shape(far)) + 1e-9 < target) {
    // This direction cannot reach it. The far end is the best there is, and
    // verification decides whether that is good enough.
    return shape(far);
  }
  for (let index = 0; index < 40; index += 1) {
    const mid = (near + far) / 2;
    if (contrastRatio(against, shape(mid)) + 1e-9 < target) {
      near = mid;
    } else {
      far = mid;
    }
  }
  return shape(far);
}

/**
 * Checks the extended system the way certify checks a preset.
 *
 * Both at the stops and between them: a foreground solved to sit exactly on
 * its target at each end can still dip below it in the middle, because
 * contrast is not linear in lightness while interpolation is.
 */
function verifyExtension<TPhase extends string>(
  system: ThemeSystem<TPhase>,
  preset: ThemeSystem<TPhase>
): { message: string; role: NormalizedThemeRolePair } | null {
  // Only the pairs that are new here. The preset's own were certified when it
  // was generated, and its tokens are untouched.
  //
  // The level is part of the identity: declaring an existing pair at a higher
  // level is a different claim, and treating it as already-certified would
  // silently accept a bar the preset never cleared.
  const key = (role: NormalizedThemeRolePair) =>
    `${role.bg} ${role.fg} @${role.min}`;
  const existing = new Set(preset.roles.map(key));
  const added = system.roles.filter((role) => !existing.has(key(role)));
  if (added.length === 0) {
    return null;
  }

  const stops = system.stops;
  const STEPS = 32;
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    const next = stops[(index + 1) % stops.length];
    if (!stop || !next) continue;
    // Held intervals do not blend, so only the held values themselves matter.
    const steps = stop.jumpAfter ? 1 : STEPS;
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      for (const role of added) {
        const bgFrom = stop.tokens[role.bg];
        const bgTo = next.tokens[role.bg];
        const fgFrom = stop.tokens[role.fg];
        const fgTo = next.tokens[role.fg];
        if (!bgFrom || !bgTo || !fgFrom || !fgTo) continue;
        const bg = stop.jumpAfter ? bgFrom : mix(bgFrom, bgTo, t);
        const fg = stop.jumpAfter ? fgFrom : mix(fgFrom, fgTo, t);
        const actual = contrastRatio(bg, fg);
        const required = contrastThreshold(role.min);
        if (actual + 1e-9 < required) {
          const minute = stop.minute + t * distance(stop.minute, next.minute);
          return {
            role,
            message:
              `"${role.fg}" on "${role.bg}" reaches only ` +
              `${actual.toFixed(2)}:1 near minute ${Math.round(minute)} ` +
              `(${stop.phase} to ${next.phase}), needs ${required}:1.`
          };
        }
      }
    }
  }
  return null;
}

function distance(from: number, to: number): number {
  return to > from ? to - from : to + MINUTES_PER_DAY - from;
}
