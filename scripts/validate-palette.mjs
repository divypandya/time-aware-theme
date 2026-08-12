import { createFixtureSystem } from './fixture.mjs';
import { resolveThemeAt } from '../dist/index.js';

let culori = null;
try {
  culori = await import('culori');
} catch {
  culori = null;
}

const system = createFixtureSystem();

for (let minute = 0; minute < 1_440; minute += 1) {
  const snapshot = resolveThemeAt(system, minute);
  for (const [key, value] of Object.entries(snapshot.tokens)) {
    if (
      !value ||
      value.l < 0 ||
      value.l > 1 ||
      value.c < 0 ||
      value.alpha < 0 ||
      value.alpha > 1
    ) {
      throw new Error(`Invalid token value at minute ${minute} for ${key}`);
    }
  }

  if (culori) {
    const toRgb =
      typeof culori.converter === 'function' ? culori.converter('rgb') : null;
    const wcagContrast =
      typeof culori.wcagContrast === 'function' ? culori.wcagContrast : null;

    if (toRgb && wcagContrast) {
      const background = toRgb(toCuloriOklch(snapshot.tokens.background));
      const foreground = toRgb(toCuloriOklch(snapshot.tokens.foreground));
      const contrast = wcagContrast(background, foreground);
      if (contrast < 4.5) {
        console.warn(
          `Minute ${minute} contrast ${contrast.toFixed(2)} is below 4.5:1.`
        );
      }
    }
  }
}

console.log('Validation fixture sampled for all 1,440 minutes.');

function toCuloriOklch(color) {
  return {
    mode: 'oklch',
    l: color.l,
    c: color.c,
    h: color.h ?? undefined,
    alpha: color.alpha
  };
}
