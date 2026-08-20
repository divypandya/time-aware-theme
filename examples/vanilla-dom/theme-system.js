import { defineThemeSystem } from '../../dist/index.js';
import { solveSchedule } from '../../dist/solve.js';

// A plain day, with no `appearance` and no hand-placed switch.
//
// Through 0.3.0 this file placed both swaps itself with holdThenSnap(), and
// the palettes either side were far apart: the background jumped 0.770 in
// lightness in a single minute, which is most of its daily range. The
// recording at the top of the README is made from this file, so the front page
// of the package was demonstrating exactly the lurch the presets had just
// stopped doing.
//
// Two things fix it, and they are the same two that fixed the presets.
//
// Text sits near the ends of the lightness range rather than at a comfortable
// middle. The band the background has to cross is
//
//     gap = t * (Y_darkText + 0.05) - (Y_lightText + 0.05) / t
//
// which shrinks as the two text colours move apart. At 0.94 and 0.25 the band
// was wide enough to need a jump; near 0.985 and 0.145 it nearly closes.
//
// And the switch is solved rather than placed. Where a theme changes polarity
// is not a design decision - it is wherever the contrast maths still allows
// both sides - and a person picking it by hand picks a worse spot and has to
// pick again every time the palette moves.

// Near-white text carries only 0.004 chroma. That is not taste: at L=0.985 the
// sRGB gamut allows about 0.006 at these hues, and 0.008 - which reads as a
// perfectly reasonable number - is outside it, so the browser silently clips
// it and the contrast maths describes a colour nobody sees. maxChromaInGamut()
// from /testing is what this was measured with.

// The accent keeps one polarity all day - dark, carrying near-white text -
// exactly as the shipped presets do. Pairing it with the page instead would
// force it to change sides at the switch, because no single colour sits 3:1
// from both a near-black and a near-white background, and that flip costs more
// than the page change does.
const night = {
  background: 'oklch(0.16 0.03 265 / 1)',
  foreground: 'oklch(0.985 0.004 265 / 1)',
  accent: 'oklch(0.5 0.15 300 / 1)',
  accentForeground: 'oklch(0.985 0.004 300 / 1)'
};

const dawn = {
  background: 'oklch(0.24 0.045 285 / 1)',
  foreground: 'oklch(0.985 0.004 285 / 1)',
  accent: 'oklch(0.5 0.15 320 / 1)',
  accentForeground: 'oklch(0.985 0.004 320 / 1)'
};

const sunrise = {
  background: 'oklch(0.96 0.018 68 / 1)',
  foreground: 'oklch(0.145 0.012 68 / 1)',
  accent: 'oklch(0.5 0.15 35 / 1)',
  accentForeground: 'oklch(0.985 0.004 35 / 1)'
};

const midday = {
  background: 'oklch(0.985 0.004 95 / 1)',
  foreground: 'oklch(0.145 0.01 95 / 1)',
  accent: 'oklch(0.48 0.15 28 / 1)',
  accentForeground: 'oklch(0.985 0.004 28 / 1)'
};

const dusk = {
  background: 'oklch(0.93 0.026 58 / 1)',
  foreground: 'oklch(0.145 0.014 58 / 1)',
  accent: 'oklch(0.5 0.15 25 / 1)',
  accentForeground: 'oklch(0.985 0.004 25 / 1)'
};

const evening = {
  background: 'oklch(0.2 0.04 300 / 1)',
  foreground: 'oklch(0.985 0.004 300 / 1)',
  accent: 'oklch(0.5 0.15 330 / 1)',
  accentForeground: 'oklch(0.985 0.004 330 / 1)'
};

const { system } = solveSchedule({
  name: 'time-aware-theme-demo',
  staticThemes: { light: midday, dark: night },
  // Declaring roles turns the crossing bug into a build-time error rather than
  // something a user only notices at dusk. Note what is not declared: the
  // accent against the page. Nothing here certifies the accent as text on the
  // background, so index.html reads its clock from --tat-foreground and uses
  // the accent only as a fill, with --tat-accent-foreground on top.
  roles: {
    pairs: [
      { bg: 'background', fg: 'foreground', min: 'AA' },
      { bg: 'accent', fg: 'accentForeground', min: 'AA' }
    ]
  },
  curve: [
    { minute: 0, phase: 'night', tokens: night },
    { minute: 300, phase: 'dawn', tokens: dawn },
    { minute: 420, phase: 'sunrise', tokens: sunrise },
    { minute: 720, phase: 'midday', tokens: midday },
    { minute: 1140, phase: 'dusk', tokens: dusk },
    { minute: 1260, phase: 'evening', tokens: evening },
    { minute: 1380, phase: 'night', tokens: night }
  ]
});

export const demoThemeSystem = defineThemeSystem(system);
