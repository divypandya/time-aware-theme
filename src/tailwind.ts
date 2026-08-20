import type { ThemeSystem } from './core.js';

export interface TailwindThemeOptions {
  /**
   * Prefix the controller writes its custom properties with. Must match the
   * controller's `cssVariablePrefix`, or the generated mapping points at
   * variables nothing ever sets.
   */
  readonly cssVariablePrefix?: string | null;
  /**
   * Tailwind namespace to map into. `color` produces `--color-background`,
   * which is what `bg-background` and `text-background` read.
   */
  readonly namespace?: string;
  /** Restrict output to a subset of token keys. Defaults to all of them. */
  readonly include?: readonly string[];
}

const DEFAULT_PREFIX = 'tat';
const DEFAULT_NAMESPACE = 'color';

function sourceVariable(prefix: string | null, key: string): string {
  return prefix === null || prefix === '' ? `--${key}` : `--${prefix}-${key}`;
}

/**
 * Generates the `@theme inline` block mapping resolved tokens to Tailwind.
 *
 * Hand-writing this was the single most tedious part of integrating v0.1.0 —
 * every token copied twice, and silently wrong if a name drifted.
 *
 * Note that if the controller is configured with `cssVariablePrefix: 'color'`
 * the variables it writes are *already* in Tailwind's namespace, so this block
 * is unnecessary. It is generated anyway (as an identity mapping) only when
 * explicitly asked for, so the two paths do not disagree.
 */
export function themeInlineCss<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  options: TailwindThemeOptions = {}
): string {
  const prefix =
    options.cssVariablePrefix === undefined
      ? DEFAULT_PREFIX
      : options.cssVariablePrefix;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const keys = options.include ?? system.tokenKeys;

  const unknown = keys.filter((key) => !system.tokenKeys.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(
      `themeInlineCss() include lists unknown token key(s): ${unknown.join(', ')}.`
    );
  }

  const declarations = keys
    .map(
      (key) => `  --${namespace}-${key}: var(${sourceVariable(prefix, key)});`
    )
    .join('\n');

  return `@theme inline {\n${declarations}\n}`;
}

/**
 * Generates the static fallback block.
 *
 * The controller sets custom properties at runtime, so before it starts —
 * during SSR, or with JavaScript disabled — the variables are unset and every
 * colour resolves to nothing. Emitting the static light theme at `:root` and
 * the dark theme under `.dark` means the page is styled before hydration and
 * degrades sensibly without JS.
 */
export function staticFallbackCss<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  options: TailwindThemeOptions = {}
): string {
  const prefix =
    options.cssVariablePrefix === undefined
      ? DEFAULT_PREFIX
      : options.cssVariablePrefix;
  const keys = options.include ?? system.tokenKeys;

  const block = (variant: 'light' | 'dark'): string =>
    keys
      .map((key) => {
        const color = system.staticThemes[variant][key];
        if (!color) {
          throw new TypeError(`Missing token "${key}" in ${variant} theme.`);
        }
        const hue = color.h ?? 'none';
        return `  ${sourceVariable(prefix, key)}: oklch(${color.l} ${color.c} ${hue} / ${color.alpha});`;
      })
      .join('\n');

  return `:root {\n${block('light')}\n}\n\n.dark {\n${block('dark')}\n}`;
}

/**
 * Everything a Tailwind v4 stylesheet needs for a theme system, in order.
 *
 * ```css
 * @import 'tailwindcss';
 * /* paste the output of tailwindCss(system) here *\/
 * ```
 */
/**
 * The rule that stops the browser fading through the switch.
 *
 * The resolver never blends across a declared change, but a transition will:
 * given `transition: background-color .35s`, the browser animates between two
 * clean values and paints the crossing on the way. The controller flags that
 * single frame; this is what acts on the flag.
 */
export function transitionCss(
  options: { readonly flipAttribute?: string } = {}
): string {
  const attribute = options.flipAttribute ?? 'data-theme-flip';
  return `[${attribute}] * {\n  transition: none !important;\n}`;
}

export function tailwindCss<TPhase extends string = string>(
  system: ThemeSystem<TPhase>,
  options: TailwindThemeOptions = {}
): string {
  return [
    staticFallbackCss(system, options),
    themeInlineCss(system, options),
    transitionCss()
  ].join('\n\n');
}
