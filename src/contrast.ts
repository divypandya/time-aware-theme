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
