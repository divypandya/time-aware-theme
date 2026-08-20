import type { ContrastLevel, OklchColor } from './core.js';

const CONTRAST_THRESHOLDS: Readonly<Record<ContrastLevel, number>> = {
  AAA: 7,
  AA: 4.5,
  'AA-large': 3,
  'non-text': 3
};

/** Minimum contrast ratio required by a WCAG level. */
export function contrastThreshold(level: ContrastLevel): number {
  return CONTRAST_THRESHOLDS[level];
}

/**
 * Converts an OKLCH color to linear-light sRGB.
 *
 * Values outside [0, 1] indicate the color is outside the sRGB gamut; they are
 * returned unclamped so callers can detect that. Implemented here rather than
 * pulled from a color library because the package ships zero runtime
 * dependencies.
 */
function oklchToLinearSrgb(color: OklchColor): [number, number, number] {
  const hueRadians = ((color.h ?? 0) * Math.PI) / 180;
  const a = color.c * Math.cos(hueRadians);
  const b = color.c * Math.sin(hueRadians);

  const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b;

  const long = lRoot * lRoot * lRoot;
  const medium = mRoot * mRoot * mRoot;
  const short = sRoot * sRoot * sRoot;

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short
  ];
}

/** True when the color falls outside the sRGB gamut and will be clipped. */
export function isOutOfSrgbGamut(color: OklchColor, tolerance = 1e-4): boolean {
  return oklchToLinearSrgb(color).some(
    (channel) => channel < -tolerance || channel > 1 + tolerance
  );
}

/** WCAG 2.2 relative luminance. */
export function relativeLuminance(color: OklchColor): number {
  const [red, green, blue] = oklchToLinearSrgb(color).map((channel) =>
    Math.min(1, Math.max(0, channel))
  ) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.2 contrast ratio between two colors. Order-independent, 1..21. */
export function contrastRatio(left: OklchColor, right: OklchColor): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsContrast(
  left: OklchColor,
  right: OklchColor,
  level: ContrastLevel = 'AA'
): boolean {
  return contrastRatio(left, right) + 1e-9 >= contrastThreshold(level);
}

export function meetsWcagAA(left: OklchColor, right: OklchColor): boolean {
  return meetsContrast(left, right, 'AA');
}

/**
 * Chroma is not free: how much of it fits depends on lightness and hue.
 *
 * sRGB in OKLCH is a lumpy solid, not a cylinder. At L=0.5 a warm hue holds
 * roughly 0.20 chroma while a green holds about 0.10, and near white or black
 * every hue collapses to nearly none. Authoring a dark amber accent is
 * therefore not a matter of taste — asked for one at 0.14 chroma the answer is
 * that it does not exist, and the browser silently clips it to something
 * duller and slightly off-hue. Contrast maths then runs on the colour you
 * asked for rather than the one on screen.
 *
 * Bisection rather than an analytic solve: the cube roots in the OKLab
 * transform make the boundary awkward to invert, and 32 halvings settle to
 * ~1e-10, far below anything a display can show.
 */
export function maxChromaInGamut(
  lightness: number,
  hue: number | null
): number {
  if (!(lightness > 0) || lightness >= 1) {
    return 0;
  }
  const h = hue ?? 0;
  let low = 0;
  // Nothing in sRGB reaches 0.4 chroma; the most saturated blues stop near
  // 0.32. Starting above the maximum keeps the first halving meaningful.
  let high = 0.4;
  for (let index = 0; index < 32; index += 1) {
    const mid = (low + high) / 2;
    if (isOutOfSrgbGamut({ l: lightness, c: mid, h, alpha: 1 })) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return low;
}

/**
 * How much of the maximum to actually use.
 *
 * Two colours can each sit inside the gamut while the straight line between
 * them leaves it — the solid is not convex in OKLCH. Measured on two fitted
 * near-white endpoints, 18 of 101 interpolated samples fell outside. Since
 * this package's whole job is to interpolate, sitting on the boundary is not
 * an option, and shaving the last two percent would not have caught that case.
 */
export const GAMUT_CHROMA_SAFETY = 0.86;

/**
 * Pulls chroma down until the colour fits, leaving lightness and hue alone.
 *
 * Lightness is what contrast is computed from, so it is the one channel that
 * must survive: clipping it to reach the gamut would quietly break the
 * guarantee the schedule was certified against. Chroma is the channel with
 * slack.
 */
export function clampChromaToGamut(
  color: OklchColor,
  safety: number = GAMUT_CHROMA_SAFETY
): OklchColor {
  const ceiling = maxChromaInGamut(color.l, color.h) * safety;
  return color.c <= ceiling ? color : { ...color, c: ceiling };
}
