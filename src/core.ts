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

export interface ThemeSystemInput<
  TTokens extends ThemeTokens = ThemeTokens,
  TPhase extends string = string
> {
  readonly name?: string;
  readonly staticThemes: {
    readonly light: TTokens;
    readonly dark: TTokens;
  };
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
}

export interface ThemeCssSnapshot {
  readonly tokens: Readonly<Record<string, string>>;
  readonly cssText: string;
}

export function defineThemeSystem<
  TTokens extends ThemeTokens,
  TPhase extends string = string
>(input: ThemeSystemInput<TTokens, TPhase>): ThemeSystem<TPhase> {
  if (!input?.staticThemes) {
    throw new TypeError('defineThemeSystem() requires staticThemes.');
  }
  if (!input.staticThemes.light || !input.staticThemes.dark) {
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

  return deepFreeze({
    ...(input.name ? { name: input.name } : {}),
    tokenKeys,
    staticThemes: {
      light: normalizedLight,
      dark: normalizedDark
    },
    stops
  });
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
      cssText: toCssText(system.tokenKeys, stop.tokens)
    });
  }

  const exact = findExactStop(stops, normalizedMinute);
  if (exact) {
    return freezeSnapshot({
      mode: 'time-aware',
      appearance: exact.appearance,
      phase: exact.phase,
      minute: normalizedMinute,
      tokens: exact.tokens,
      cssText: toCssText(system.tokenKeys, exact.tokens)
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
    cssText: toCssText(system.tokenKeys, tokens)
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
      cssText: toCssText(system.tokenKeys, tokens)
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

  if (input.appearance !== 'light' && input.appearance !== 'dark') {
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

function normalizeTokenMap<TTokens extends ThemeTokens>(
  input: TTokens,
  tokenKeys: readonly string[],
  label: string
): Readonly<Record<string, OklchColor>> {
  if (input === null || typeof input !== 'object') {
    throw new TypeError(`${label} must be an object.`);
  }

  const keys = objectKeys(input);
  validateTokenKeys(keys, tokenKeys, label);

  const normalized: Record<string, OklchColor> = {};
  for (const key of tokenKeys) {
    const token = (input as Record<string, OklchInput>)[key];
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

function normalizeOklch(input: OklchInput, label: string): OklchColor {
  if (typeof input === 'string') {
    return parseOklchString(input, label);
  }

  if (input === null || typeof input !== 'object') {
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

function findExactStop<TPhase extends string>(
  stops: readonly NormalizedThemeStop<TPhase>[],
  minute: number
): NormalizedThemeStop<TPhase> | undefined {
  return stops.find((stop) => stop.minute === minute);
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

function objectKeys<T extends object>(value: T): string[] {
  return Object.keys(value);
}
