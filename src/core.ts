export const MINUTES_PER_DAY = 24 * 60;
const EPSILON = 1e-6;

export type ThemeMode = 'light' | 'dark' | 'time-aware';
export type ThemeAppearance = 'light' | 'dark';

export interface OklchColor {
  readonly l: number;
  readonly c: number;
  readonly h: number | null;
  readonly alpha: number;
}

export type OklchInput = string | Partial<OklchColor>;
export type ThemeTokens = Record<string, OklchInput>;

export interface ThemeStopInput<
  TTokens extends ThemeTokens = ThemeTokens,
  TPhase extends string = string
> {
  readonly minute: number;
  readonly appearance: ThemeAppearance;
  readonly phase: TPhase;
  readonly tokens: TTokens;
}

/**
 * Minimum contrast level for a declared role pair.
 *
 * - `AAA` — 7:1, WCAG 2.2 enhanced body text
 * - `AA` — 4.5:1, WCAG 2.2 normal body text (default)
 * - `AA-large` — 3:1, text >=18.66px or >=14px bold
 * - `non-text` — 3:1, WCAG 1.4.11 borders / focus rings / icons
 */
export type ContrastLevel = 'AAA' | 'AA' | 'AA-large' | 'non-text';

const CONTRAST_LEVELS: readonly ContrastLevel[] = [
  'AAA',
  'AA',
  'AA-large',
  'non-text'
];

export interface ThemeRolePair {
  readonly bg: string;
  readonly fg: string;
  readonly min?: ContrastLevel;
}

export interface ThemeRoles {
  readonly pairs: readonly ThemeRolePair[];
}

export interface NormalizedThemeRolePair {
  readonly bg: string;
  readonly fg: string;
  readonly min: ContrastLevel;
}

export interface ThemeSystemInput<
  TTokens extends ThemeTokens = ThemeTokens,
  TPhase extends string = string
> {
  readonly name?: string;
  readonly staticThemes: {
    readonly light: TTokens;
    readonly dark: TTokens;
  };
  /**
   * Declares which token pairs carry a foreground-on-background relationship.
   *
   * Roles are validation targeting only — they never alter interpolation. They
   * are consumed by the authoring-time swap lint (below), by
   * `assertContrast()` in the `/testing` entry point, and by `inspect()`.
   */
  readonly roles?: ThemeRoles;
  readonly stops: readonly ThemeStopInput<TTokens, TPhase>[];
}

export interface NormalizedThemeStop<TPhase extends string = string> {
  readonly minute: number;
  readonly appearance: ThemeAppearance;
  readonly phase: TPhase;
  readonly tokens: Readonly<Record<string, OklchColor>>;
}

export interface ThemeSystem<TPhase extends string = string> {
  readonly name?: string;
  readonly tokenKeys: readonly string[];
  readonly roles: readonly NormalizedThemeRolePair[];
  readonly staticThemes: {
    readonly light: Readonly<Record<string, OklchColor>>;
    readonly dark: Readonly<Record<string, OklchColor>>;
  };
  readonly stops: readonly NormalizedThemeStop<TPhase>[];
}

export interface ThemeSnapshot<TPhase extends string = string> {
  readonly mode: ThemeMode;
  readonly appearance: ThemeAppearance;
  readonly phase: TPhase | 'static';
  readonly minute: number;
  readonly tokens: Readonly<Record<string, OklchColor>>;
  readonly cssText: string;
  /**
   * Progress through the current stop-to-stop interval, 0..1.
   *
   * `0` at an exact stop minute and in static modes. Sawtooth: rises toward 1
   * as the next stop approaches, then resets to 0 once that stop is reached.
   */
  readonly progress: number;
  /** Phase of the stop being interpolated toward. Wraps at end of day. */
  readonly nextPhase: TPhase | 'static';
  /** Appearance of the stop being interpolated toward. Wraps at end of day. */
  readonly nextAppearance: ThemeAppearance;
}

export interface ThemeCssSnapshot {
  readonly tokens: Readonly<Record<string, string>>;
  readonly cssText: string;
}

export function defineThemeSystem<
  TTokens extends ThemeTokens,
  TPhase extends string = string
>(input: ThemeSystemInput<TTokens, TPhase>): ThemeSystem<TPhase> {
  const unvalidatedInput = input as
    | {
        staticThemes?: { light?: TTokens; dark?: TTokens } | null;
      }
    | null
    | undefined;
  if (!unvalidatedInput?.staticThemes) {
    throw new TypeError('defineThemeSystem() requires staticThemes.');
  }
  if (
    !unvalidatedInput.staticThemes.light ||
    !unvalidatedInput.staticThemes.dark
  ) {
    throw new TypeError(
      'defineThemeSystem() requires both light and dark static themes.'
    );
  }

  const lightKeys = objectKeys(input.staticThemes.light);
  if (lightKeys.length === 0) {
    throw new TypeError('defineThemeSystem() requires at least one token.');
  }

  const tokenKeys = freezeArray(lightKeys);
  const normalizedLight = normalizeTokenMap(
    input.staticThemes.light,
    tokenKeys,
    'staticThemes.light'
  );
  const normalizedDark = normalizeTokenMap(
    input.staticThemes.dark,
    tokenKeys,
    'staticThemes.dark'
  );

  const stops = input.stops.map((stop, index) =>
    normalizeStop(stop, tokenKeys, index)
  );
  if (stops.length === 0) {
    throw new TypeError('defineThemeSystem() requires at least one stop.');
  }

  validateSortedUniqueStops(stops);

  const roles = normalizeRoles(input.roles, tokenKeys);
  validateNoObservableRoleSwap(stops, roles);
  warnOnDegenerateSchedule(stops, input.name);

  return deepFreeze({
    ...(input.name ? { name: input.name } : {}),
    tokenKeys,
    roles,
    staticThemes: {
      light: normalizedLight,
      dark: normalizedDark
    },
    stops
  });
}

/**
 * Expands a role swap into a hold stop and a snap stop one minute later.
 *
 * `resolveThemeAt` only ever evaluates integer minutes (`normalizeMinute`
 * truncates), so two stops one minute apart have no sampleable interior. The
 * foreground/background crossing that would otherwise collapse contrast to
 * ~1:1 mid-interval becomes unobservable rather than merely unlikely.
 */
export function holdThenSnap<
  TTokens extends ThemeTokens,
  TPhase extends string = string
>(options: {
  readonly at: number;
  readonly from: TTokens;
  readonly to: TTokens;
  readonly fromAppearance: ThemeAppearance;
  readonly toAppearance: ThemeAppearance;
  readonly phase: TPhase;
  readonly nextPhase: TPhase;
}): readonly [
  ThemeStopInput<TTokens, TPhase>,
  ThemeStopInput<TTokens, TPhase>
] {
  const at = normalizeMinute(options.at);
  return [
    {
      minute: at,
      appearance: options.fromAppearance,
      phase: options.phase,
      tokens: options.from
    },
    {
      minute: normalizeMinute(at + 1),
      appearance: options.toAppearance,
      phase: options.nextPhase,
      tokens: options.to
    }
  ];
}

export function resolveThemeAt<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  minute: number
): ThemeSnapshot<TPhase> {
  const normalizedMinute = normalizeMinute(minute);
  const stops = system.stops;

  if (stops.length === 1) {
    const stop = stops[0];
    if (!stop) {
      throw new Error('Invalid stop set.');
    }
    return freezeSnapshot({
      mode: 'time-aware',
      appearance: stop.appearance,
      phase: stop.phase,
      minute: normalizedMinute,
      tokens: stop.tokens,
      cssText: toCssText(system.tokenKeys, stop.tokens),
      progress: 0,
      nextPhase: stop.phase,
      nextAppearance: stop.appearance
    });
  }

  const exactIndex = stops.findIndex(
    (stop) => stop.minute === normalizedMinute
  );
  if (exactIndex !== -1) {
    const exact = stops[exactIndex];
    // At an exact stop we sit at the *start* of the interval that stop opens,
    // so `next` is the following stop rather than this one. This keeps the
    // sawtooth continuous: progress approaches 1, resets to 0, and `nextPhase`
    // advances in the same tick.
    const following = stops[(exactIndex + 1) % stops.length];
    if (!exact || !following) {
      throw new Error('Invalid stop set.');
    }
    return freezeSnapshot({
      mode: 'time-aware',
      appearance: exact.appearance,
      phase: exact.phase,
      minute: normalizedMinute,
      tokens: exact.tokens,
      cssText: toCssText(system.tokenKeys, exact.tokens),
      progress: 0,
      nextPhase: following.phase,
      nextAppearance: following.appearance
    });
  }

  const { previous, next, span, elapsed } = findBracketingStops(
    stops,
    normalizedMinute
  );
  const t = span === 0 ? 0 : elapsed / span;
  const tokens = interpolateTokenMap(previous.tokens, next.tokens, t);

  return freezeSnapshot({
    mode: 'time-aware',
    appearance: previous.appearance,
    phase: previous.phase,
    minute: normalizedMinute,
    tokens,
    cssText: toCssText(system.tokenKeys, tokens),
    progress: t,
    nextPhase: next.phase,
    nextAppearance: next.appearance
  });
}

export function resolveThemeSnapshot<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  mode: ThemeMode,
  minute: number
): ThemeSnapshot<TPhase> {
  if (mode === 'light' || mode === 'dark') {
    const tokens = system.staticThemes[mode];
    return freezeSnapshot({
      mode,
      appearance: mode,
      phase: 'static',
      minute: normalizeMinute(minute),
      tokens,
      cssText: toCssText(system.tokenKeys, tokens),
      progress: 0,
      nextPhase: 'static',
      nextAppearance: mode
    }) as ThemeSnapshot<TPhase>;
  }

  return resolveThemeAt(system, minute);
}

export function serializeOklch(color: OklchColor): string {
  return `oklch(${formatNumber(color.l)} ${formatNumber(color.c)} ${
    color.h === null ? 'none' : formatNumber(normalizeHue(color.h))
  } / ${formatNumber(color.alpha)})`;
}

export function normalizeMinute(minute: number): number {
  if (!Number.isFinite(minute)) {
    throw new TypeError('Minute must be a finite number.');
  }

  const rounded = Math.trunc(minute);
  const normalized =
    ((rounded % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return normalized;
}

function normalizeStop<TTokens extends ThemeTokens, TPhase extends string>(
  input: ThemeStopInput<TTokens, TPhase>,
  tokenKeys: readonly string[],
  index: number
): NormalizedThemeStop<TPhase> {
  if (!Number.isFinite(input.minute)) {
    throw new TypeError(`Stop ${index} minute must be a finite number.`);
  }

  const minute = normalizeMinute(input.minute);
  const tokens = normalizeTokenMap(
    input.tokens,
    tokenKeys,
    `stops[${index}].tokens`
  );

  const appearance: string = input.appearance;
  if (appearance !== 'light' && appearance !== 'dark') {
    throw new TypeError(`Stop ${index} appearance must be "light" or "dark".`);
  }

  if (typeof input.phase !== 'string' || input.phase.length === 0) {
    throw new TypeError(`Stop ${index} phase must be a non-empty string.`);
  }

  return {
    minute,
    appearance: input.appearance,
    phase: input.phase,
    tokens
  };
}

function normalizeTokenMap(
  input: ThemeTokens,
  tokenKeys: readonly string[],
  label: string
): Readonly<Record<string, OklchColor>> {
  const unvalidatedInput = input as ThemeTokens | null | undefined;
  if (unvalidatedInput === null || typeof unvalidatedInput !== 'object') {
    throw new TypeError(`${label} must be an object.`);
  }

  const keys = objectKeys(input);
  validateTokenKeys(keys, tokenKeys, label);

  const normalized: Record<string, OklchColor> = {};
  for (const key of tokenKeys) {
    const token = input[key];
    if (token === undefined) {
      throw new TypeError(`${label}.${key} is missing.`);
    }
    normalized[key] = normalizeOklch(token, `${label}.${key}`);
  }

  return deepFreeze(normalized);
}

function validateTokenKeys(
  keys: readonly string[],
  tokenKeys: readonly string[],
  label: string
): void {
  if (keys.length !== tokenKeys.length) {
    throw new TypeError(
      `${label} must contain exactly ${tokenKeys.length} token keys.`
    );
  }

  const expected = new Set(tokenKeys);
  for (const key of keys) {
    if (!expected.has(key)) {
      throw new TypeError(`${label} includes unexpected token key "${key}".`);
    }
  }
}

function validateSortedUniqueStops<TPhase extends string>(
  stops: readonly NormalizedThemeStop<TPhase>[]
): void {
  let previousMinute = -1;
  const seen = new Set<number>();

  for (const stop of stops) {
    if (seen.has(stop.minute)) {
      throw new TypeError(
        `Duplicate stop minute ${stop.minute} is not allowed.`
      );
    }
    seen.add(stop.minute);

    if (stop.minute <= previousMinute) {
      throw new TypeError(
        'Stops must be ordered by strictly increasing minute.'
      );
    }
    previousMinute = stop.minute;
  }
}

function normalizeRoles(
  input: ThemeRoles | undefined,
  tokenKeys: readonly string[]
): readonly NormalizedThemeRolePair[] {
  if (!input) {
    return freezeArray([]);
  }

  const rawPairs: unknown = input.pairs;
  if (!Array.isArray(rawPairs)) {
    throw new TypeError('roles.pairs must be an array.');
  }

  const known = new Set(tokenKeys);
  const normalized = (rawPairs as readonly unknown[]).map((entry, index) => {
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError(`roles.pairs[${index}] must be an object.`);
    }
    const pair = entry as Partial<ThemeRolePair>;

    const sides: Record<'bg' | 'fg', string> = { bg: '', fg: '' };
    for (const side of ['bg', 'fg'] as const) {
      const value = pair[side];
      if (typeof value !== 'string' || !known.has(value)) {
        throw new TypeError(
          `roles.pairs[${index}].${side} must reference a declared token key.`
        );
      }
      sides[side] = value;
    }

    // Read as unknown and match against the permitted values: the declared
    // type would let TypeScript assume this is already a ContrastLevel, but
    // untyped JavaScript callers reach here too. Looking the value up in the
    // list narrows it without an assertion.
    const rawMin: unknown = (entry as { min?: unknown }).min ?? 'AA';
    const min = CONTRAST_LEVELS.find((level) => level === rawMin);
    if (!min) {
      throw new TypeError(
        `roles.pairs[${index}].min must be "AAA", "AA", "AA-large", or "non-text".`
      );
    }
    return { bg: sides.bg, fg: sides.fg, min };
  });

  return deepFreeze(freezeArray(normalized));
}

/**
 * Rejects role swaps that a consumer can actually observe.
 *
 * If `fg.l - bg.l` changes sign between consecutive stops, the two tokens
 * cross, and contrast collapses toward 1:1 somewhere in between. That is only
 * a real defect when an integer minute exists strictly between the two stops —
 * a one-minute gap (see `holdThenSnap`) has no sampleable interior, so the
 * crossing can never be rendered.
 */
function validateNoObservableRoleSwap<TPhase extends string>(
  stops: readonly NormalizedThemeStop<TPhase>[],
  roles: readonly NormalizedThemeRolePair[]
): void {
  if (roles.length === 0 || stops.length < 2) {
    return;
  }

  for (let index = 0; index < stops.length; index += 1) {
    const previous = stops[index];
    const next = stops[(index + 1) % stops.length];
    if (!previous || !next) {
      continue;
    }

    const span =
      next.minute > previous.minute
        ? next.minute - previous.minute
        : next.minute + MINUTES_PER_DAY - previous.minute;
    if (span <= 1) {
      continue;
    }

    for (const role of roles) {
      const previousDelta = signedDelta(previous.tokens, role);
      const nextDelta = signedDelta(next.tokens, role);
      if (previousDelta === 0 || nextDelta === 0) {
        continue;
      }
      if (previousDelta > 0 !== nextDelta > 0) {
        throw new TypeError(
          `Role pair "${role.fg}" on "${role.bg}" swaps sides between minute ` +
            `${previous.minute} (${previous.phase}) and ${next.minute} ` +
            `(${next.phase}) across a ${span}-minute interval. The two tokens ` +
            `cross mid-interval and contrast collapses to ~1:1. Use ` +
            `holdThenSnap() so the swap happens in a single minute.`
        );
      }
    }
  }
}

function signedDelta(
  tokens: Readonly<Record<string, OklchColor>>,
  role: NormalizedThemeRolePair
): number {
  const fg = tokens[role.fg];
  const bg = tokens[role.bg];
  if (!fg || !bg) {
    return 0;
  }
  const delta = fg.l - bg.l;
  return Math.abs(delta) <= EPSILON ? 0 : delta;
}

/**
 * Warns when a schedule declares more stops than it has distinct token sets —
 * the authoring mistake behind "my five phases only render as two".
 */
function warnOnDegenerateSchedule<TPhase extends string>(
  stops: readonly NormalizedThemeStop<TPhase>[],
  name: string | undefined
): void {
  if (!isDevMode() || stops.length < 3) {
    return;
  }

  const serialized = stops.map((stop) => JSON.stringify(stop.tokens));

  // Consecutive duplicates are deliberate holds (see holdThenSnap) — the
  // palette is meant to stay put across that interval. The defect this catches
  // is a schedule that *revisits* a handful of palettes, e.g. five stops
  // alternating between two token sets, which renders as two phases.
  const collapsed = serialized.filter(
    (tokens, index) => index === 0 || tokens !== serialized[index - 1]
  );

  // A schedule is a loop, so the final palette returning to the first one is
  // the cycle closing rather than a repeat. Drop it before counting.
  if (
    collapsed.length > 1 &&
    collapsed[collapsed.length - 1] === collapsed[0]
  ) {
    collapsed.pop();
  }

  const distinct = new Set(collapsed);
  if (distinct.size < collapsed.length) {
    warn(
      `${name ? `[${name}] ` : ''}${collapsed.length} stops reference only ` +
        `${distinct.size} distinct token sets, so some phases will render ` +
        `identically. Give each stop its own tokens, or remove the ` +
        `redundant stops.`
    );
  }
}

function isDevMode(): boolean {
  try {
    return (
      typeof process === 'undefined' || process.env.NODE_ENV !== 'production'
    );
  } catch {
    return true;
  }
}

function warn(message: string): void {
  try {
    console.warn(`time-aware-theme: ${message}`);
  } catch {
    // A missing or hostile console must never break theme definition.
  }
}

function normalizeOklch(input: OklchInput, label: string): OklchColor {
  if (typeof input === 'string') {
    return parseOklchString(input, label);
  }

  const unvalidatedInput = input as Partial<OklchColor> | null | undefined;
  if (unvalidatedInput === null || typeof unvalidatedInput !== 'object') {
    throw new TypeError(`${label} must be an OKLCH string or object.`);
  }

  const l = requireFinite(input.l ?? NaN, `${label}.l`);
  const c = requireFinite(input.c ?? NaN, `${label}.c`);
  const h = input.h ?? null;
  const alpha = input.alpha ?? 1;

  return validateAndFreezeOklch({ l, c, h, alpha }, label);
}

function parseOklchString(input: string, label: string): OklchColor {
  const trimmed = input.trim();
  const match = /^oklch\((.+)\)$/i.exec(trimmed);
  if (!match) {
    throw new TypeError(`${label} must be a valid oklch() string.`);
  }

  const content = match[1]?.trim();
  if (!content) {
    throw new TypeError(`${label} must contain OKLCH channels.`);
  }
  const [spaceSeparated, alphaPart] = splitAlpha(content);
  const channels = spaceSeparated.trim().split(/\s+/);

  if (channels.length !== 3) {
    throw new TypeError(`${label} must contain lightness, chroma, and hue.`);
  }

  const [lRaw, cRaw, hRaw] = channels;
  if (!lRaw || !cRaw || !hRaw) {
    throw new TypeError(`${label} must contain lightness, chroma, and hue.`);
  }
  const l = parseLightness(lRaw, `${label}.l`);
  const c = parseChroma(cRaw, `${label}.c`);
  const h = parseHue(hRaw, `${label}.h`);
  const alpha =
    alphaPart === null ? 1 : parseAlpha(alphaPart, `${label}.alpha`);

  return validateAndFreezeOklch({ l, c, h, alpha }, label);
}

function validateAndFreezeOklch(color: OklchColor, label: string): OklchColor {
  if (!Number.isFinite(color.l) || color.l < 0 || color.l > 1) {
    throw new TypeError(`${label}.l must be a finite number between 0 and 1.`);
  }
  if (!Number.isFinite(color.c) || color.c < 0) {
    throw new TypeError(`${label}.c must be a finite non-negative number.`);
  }
  if (!Number.isFinite(color.alpha) || color.alpha < 0 || color.alpha > 1) {
    throw new TypeError(
      `${label}.alpha must be a finite number between 0 and 1.`
    );
  }

  const hue = color.h === null ? null : normalizeHue(color.h);
  if (hue === null && color.c > EPSILON) {
    throw new TypeError(`${label}.h is required when chroma is non-zero.`);
  }

  return deepFreeze({
    l: roundChannel(color.l),
    c: roundChannel(color.c),
    h: hue === null ? null : roundHue(hue),
    alpha: roundChannel(color.alpha)
  });
}

function splitAlpha(input: string): [string, string | null] {
  const slashIndex = input.indexOf('/');
  if (slashIndex < 0) {
    return [input, null];
  }
  const colorPart = input.slice(0, slashIndex).trim();
  const alphaPart = input.slice(slashIndex + 1).trim();
  if (!colorPart || !alphaPart) {
    throw new TypeError('oklch() alpha slash must have values on both sides.');
  }
  return [colorPart, alphaPart];
}

function parseLightness(input: string, label: string): number {
  if (input.endsWith('%')) {
    const value = Number.parseFloat(input.slice(0, -1));
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite percentage.`);
    }
    return value / 100;
  }
  return requireFinite(Number.parseFloat(input), label);
}

function parseChroma(input: string, label: string): number {
  return requireFinite(Number.parseFloat(input), label);
}

function parseHue(input: string, label: string): number | null {
  if (input.toLowerCase() === 'none') {
    return null;
  }

  const match = /^(-?(?:\d+\.?\d*|\d*\.\d+))(deg|turn|rad|grad)?$/i.exec(input);
  if (!match) {
    throw new TypeError(`${label} must be a finite hue or "none".`);
  }

  const value = Number.parseFloat(match[1] ?? '');
  const unit = match[2]?.toLowerCase() ?? 'deg';
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite hue or "none".`);
  }

  switch (unit) {
    case 'deg':
      return value;
    case 'turn':
      return value * 360;
    case 'rad':
      return (value * 180) / Math.PI;
    case 'grad':
      return value * 0.9;
    default:
      throw new TypeError(`${label} has an unsupported unit.`);
  }
}

function parseAlpha(input: string, label: string): number {
  if (input.endsWith('%')) {
    const value = Number.parseFloat(input.slice(0, -1));
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite percentage.`);
    }
    return value / 100;
  }
  return requireFinite(Number.parseFloat(input), label);
}

function normalizeHue(input: number): number {
  const wrapped = input % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function roundChannel(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function roundHue(value: number): number {
  return Math.round(normalizeHue(value) * 100000) / 100000;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function toCssText(
  tokenKeys: readonly string[],
  tokens: Readonly<Record<string, OklchColor>>
): string {
  return tokenKeys
    .map(
      (key) =>
        `--${key}: ${serializeOklch(tokens[key] ?? failMissingToken(key))};`
    )
    .join(' ');
}

function failMissingToken(key: string): never {
  throw new TypeError(`Missing token "${key}".`);
}

function interpolateTokenMap(
  left: Readonly<Record<string, OklchColor>>,
  right: Readonly<Record<string, OklchColor>>,
  t: number
): Readonly<Record<string, OklchColor>> {
  const interpolated: Record<string, OklchColor> = {};

  for (const key of Object.keys(left)) {
    const a = left[key];
    const b = right[key];
    if (!a || !b) {
      throw new TypeError(`Missing token during interpolation for "${key}".`);
    }
    interpolated[key] = interpolateOklch(a, b, t);
  }

  return deepFreeze(interpolated);
}

function interpolateOklch(
  left: OklchColor,
  right: OklchColor,
  t: number
): OklchColor {
  const l = lerp(left.l, right.l, t);
  const c = lerp(left.c, right.c, t);
  const alpha = lerp(left.alpha, right.alpha, t);
  const h = interpolateHue(left, right, c, t);

  return validateAndFreezeOklch({ l, c, h, alpha }, 'interpolated color');
}

function interpolateHue(
  left: OklchColor,
  right: OklchColor,
  chroma: number,
  t: number
): number | null {
  if (chroma <= EPSILON) {
    return null;
  }

  const leftHue = left.c <= EPSILON ? right.h : left.h;
  const rightHue = right.c <= EPSILON ? left.h : right.h;

  if (leftHue === null && rightHue === null) {
    return null;
  }
  if (leftHue === null) {
    return rightHue;
  }
  if (rightHue === null) {
    return leftHue;
  }

  const delta = shortestHueDelta(leftHue, rightHue);
  return normalizeHue(leftHue + delta * t);
}

function shortestHueDelta(start: number, end: number): number {
  const normalizedStart = normalizeHue(start);
  const normalizedEnd = normalizeHue(end);
  return ((((normalizedEnd - normalizedStart) % 360) + 540) % 360) - 180;
}

function lerp(left: number, right: number, t: number): number {
  return left + (right - left) * t;
}

function findBracketingStops<TPhase extends string>(
  stops: readonly NormalizedThemeStop<TPhase>[],
  minute: number
): {
  previous: NormalizedThemeStop<TPhase>;
  next: NormalizedThemeStop<TPhase>;
  span: number;
  elapsed: number;
} {
  let index = stops.findIndex((stop) => stop.minute > minute);

  if (index === -1) {
    index = 0;
  }

  const previousIndex = index === 0 ? stops.length - 1 : index - 1;
  const previous = stops[previousIndex];
  const next = stops[index];

  if (!previous || !next) {
    throw new Error('Invalid stop set.');
  }

  const wrappedPreviousMinute = previous.minute;
  const wrappedNextMinute =
    next.minute > previous.minute ? next.minute : next.minute + MINUTES_PER_DAY;
  const wrappedMinute =
    minute >= wrappedPreviousMinute ? minute : minute + MINUTES_PER_DAY;

  return {
    previous,
    next,
    span: wrappedNextMinute - wrappedPreviousMinute,
    elapsed: wrappedMinute - wrappedPreviousMinute
  };
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100000) / 100000;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
  return text === '-0' ? '0' : text;
}

function freezeSnapshot<TPhase extends string>(
  snapshot: ThemeSnapshot<TPhase>
): ThemeSnapshot<TPhase> {
  return deepFreeze(snapshot);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      const nested = (value as Record<PropertyKey, unknown>)[key];
      if (nested && typeof nested === 'object') {
        deepFreeze(nested);
      }
    }
  }
  return value;
}

function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}

function objectKeys(value: object): string[] {
  return Object.keys(value);
}
