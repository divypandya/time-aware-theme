# @divypandya/time-aware-theme

[![CI](https://github.com/divypandya/time-aware-theme/actions/workflows/ci.yml/badge.svg)](https://github.com/divypandya/time-aware-theme/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@divypandya/time-aware-theme)](https://www.npmjs.com/package/@divypandya/time-aware-theme)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![types](https://img.shields.io/badge/types-TypeScript-blue)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE.md)

A theme that shifts with the time of day: a pure resolver that maps a minute of
the day to interpolated [OKLCH](https://oklch.com/) tokens, a framework-free
DOM controller that applies them, a React adapter, and deterministic testing
utilities for simulating the clock.

Interpolating a palette across a day has a trap in it — when a light-on-dark
stop moves toward a dark-on-light one, the two tokens cross and text goes
briefly invisible. This package makes that a build error rather than something
a user finds at dusk, and ships four palettes certified against it.

![Recording of the theme cycling through a full day, driven by the real DOM controller](https://raw.githubusercontent.com/divypandya/time-aware-theme/main/assets/demo.gif)

Recording of [examples/vanilla-dom](examples/vanilla-dom): dragging the
time-of-day slider (or hitting **Play 24h**) calls the real
`createThemeController`, which writes the `--tat-*` custom properties you see
updating live — this isn't a mockup. Every frame is captured from a headless
browser running the shipped controller (`npm run demo:gif`), so the animation
cannot drift from what the package actually resolves.

## Stats

|                        |                                                                            |
| ---------------------- | -------------------------------------------------------------------------- |
| Runtime dependencies   | **0**                                                                      |
| Core entry (gzip)      | ~5.2 KB incl. shared chunks, budget 6 KB                                   |
| DOM entry (gzip)       | ~5.2 KB, budget 6.5 KB                                                     |
| React UI entry (gzip)  | ~4.5 KB, budget 9 KB                                                       |
| Preset entry (gzip)    | ~4.1 KB each, budget 7 KB                                                  |
| Tailwind entry (gzip)  | ~0.5 KB, budget 2 KB                                                       |
| Resolver performance   | median < 1 ms, p95 < 3 ms per resolve ([benchmark](scripts/benchmark.mjs)) |
| Contrast certification | 1,440-minute WCAG sweep, blocking ([certify](scripts/certify.mjs))         |
| Node.js                | `>=24 <27`                                                                 |

Sizes are the **transitive** cost of each entry — the entry plus every shared
chunk it imports, which is what a consumer actually downloads. WCAG and sRGB
conversion maths lives only in the `testing` and `inspect` entries and never
reaches core, dom, or the presets.

Bundle sizes are enforced in CI on every push via `npm run size`
([scripts/size-check.mjs](scripts/size-check.mjs)); resolver performance is
checked via `npm run bench` ([scripts/benchmark.mjs](scripts/benchmark.mjs));
every shipped schedule is contrast-certified via `npm run certify`
([scripts/certify.mjs](scripts/certify.mjs)).

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Installation

```sh
npm install @divypandya/time-aware-theme
```

React is an optional peer dependency — install it only if you use the
`/react` entry point.

## Quick start

Define a theme system once: static light/dark fallbacks plus a series of
time-of-day stops. Tokens between stops are interpolated automatically.

```ts
import { defineThemeSystem, holdThenSnap } from '@divypandya/time-aware-theme';

const night = {
  background: 'oklch(0.14 0.02 260 / 1)',
  foreground: 'oklch(0.96 0.01 260 / 1)'
};
const dawn = {
  background: 'oklch(0.97 0.015 75 / 1)',
  foreground: 'oklch(0.25 0.05 55 / 1)'
};
const dusk = {
  background: 'oklch(0.93 0.02 60 / 1)',
  foreground: 'oklch(0.24 0.04 55 / 1)'
};

const system = defineThemeSystem({
  name: 'app-theme',
  staticThemes: {
    light: {
      background: 'oklch(0.97 0.01 250 / 1)',
      foreground: 'oklch(0.17 0.03 250 / 1)'
    },
    dark: {
      background: 'oklch(0.13 0.02 250 / 1)',
      foreground: 'oklch(0.96 0.01 250 / 1)'
    }
  },
  // Declare which tokens must stay legible against each other.
  roles: {
    pairs: [{ bg: 'background', fg: 'foreground', min: 'AA' }]
  },
  stops: [
    { minute: 0, appearance: 'dark', phase: 'night', tokens: night },
    // Each light/dark swap happens in one minute, so the foreground and
    // background never cross while both are on screen. See "Contrast-safe
    // role swaps" below for why this matters.
    ...holdThenSnap({
      at: 360,
      from: night,
      to: dawn,
      fromAppearance: 'dark',
      toAppearance: 'light',
      phase: 'night',
      nextPhase: 'dawn'
    }),
    ...holdThenSnap({
      at: 1080,
      from: dusk,
      to: night,
      fromAppearance: 'light',
      toAppearance: 'dark',
      phase: 'dusk',
      nextPhase: 'night'
    })
  ]
});
```

Create and start the DOM controller before mounting React so the first paint
already reflects the correct theme. The controller writes tokens as CSS custom
properties, toggles the `.dark` class, and updates `color-scheme`. It only
touches the DOM once you pass it `document`/`window` explicitly — without
them it stays inert (safe to construct during SSR).

```tsx
import { createRoot } from 'react-dom/client';
import { createThemeController } from '@divypandya/time-aware-theme/dom';
import { TimeAwareThemeProvider } from '@divypandya/time-aware-theme/react';

const controller = createThemeController({ system, document, window });
controller.start();

createRoot(document.getElementById('root')!).render(
  <TimeAwareThemeProvider controller={controller}>
    <App />
  </TimeAwareThemeProvider>
);
```

Read the resolved theme and switch modes from inside the tree:

```tsx
import { useTimeAwareTheme } from '@divypandya/time-aware-theme/react';

function ThemeToggle() {
  const { mode, appearance, phase, setMode } = useTimeAwareTheme();

  return (
    <button
      onClick={() => setMode(mode === 'time-aware' ? 'dark' : 'time-aware')}
    >
      {appearance} · {phase} ({mode})
    </button>
  );
}
```

## Contrast-safe role swaps

When a stop with a dark background and light text interpolates toward a stop
with a light background and dark text, both tokens travel through OKLCH space
and **cross each other** partway. At the crossing their lightness is identical,
so text becomes invisible — for as long as the interval is wide.

Declare which tokens form a foreground/background pair, and the crossing becomes
a build-time error instead of something a user notices at dusk:

```ts
defineThemeSystem({
  staticThemes: {/* ... */},
  roles: {
    pairs: [
      { bg: 'background', fg: 'foreground', min: 'AA' }, // 4.5:1
      { bg: 'background', fg: 'accent', min: 'AA-large' }, // 3:1
      { bg: 'background', fg: 'border', min: 'non-text' } // 3:1
    ]
  },
  stops: [/* ... */]
});
```

Roles never change interpolation — they only say which pairs must stay legible.

Use `holdThenSnap()` to move through a swap in a single minute. Because the
resolver only ever evaluates whole minutes, two stops a minute apart have no
sampleable interior, so the crossing can never be rendered:

```ts
import { holdThenSnap } from '@divypandya/time-aware-theme';

stops: [
  { minute: 0, appearance: 'dark', phase: 'night', tokens: nightTokens },
  ...holdThenSnap({
    at: 6 * 60, // hold the night palette until 06:00
    from: nightTokens,
    to: dawnTokens, // then switch at 06:01
    fromAppearance: 'dark',
    toAppearance: 'light',
    phase: 'night',
    nextPhase: 'dawn'
  })
];
```

Check a whole schedule in your own test suite:

```ts
import { assertContrast } from '@divypandya/time-aware-theme/testing';

it('stays legible all day', () => {
  assertContrast(system); // samples all 1,440 minutes
});
```

Failures name the minute, the pair, and the interval responsible:

```
Contrast below AA on 90 sample(s) between 15:49 and 17:18.
  Worst: 1.00:1 at 16:33 ("foreground" on "background", needs 4.5:1)
  Interval: afternoon -> dusk at t=0.51
```

## Smooth transitions

`appearance` stays binary because it drives the `.dark` class and
`color-scheme`. To crossfade rather than snap at the boundary, read `progress`
and `nextAppearance` from a resolved snapshot:

```ts
const { appearance, nextAppearance, progress, phase, nextPhase } =
  resolveThemeAt(system, minute);
```

`progress` runs 0→1 through the current stop interval and resets at each stop,
so you can drive an opacity crossfade, or render "dusk in 12 min" from
`nextPhase`. Respect `prefers-reduced-motion` when you do.

## Scoped previews

Point a controller at any element to theme a subtree without touching the rest
of the page — a settings-panel preview swatch, or side-by-side comparisons:

```ts
createThemeController({ system, document, target: previewEl });
```

Scoped instances are display-only: they don't persist mode, don't attach window
listeners, and don't write `color-scheme`. For a one-off with no lifecycle at
all, use `applySnapshotTo(element, snapshot, { tokenKeys })`.

## CSS variable naming

| `cssVariablePrefix` | Emits                | Use when                               |
| ------------------- | -------------------- | -------------------------------------- |
| `'tat'` (default)   | `--tat-background`   | Namespace safety                       |
| `'color'`           | `--color-background` | Tailwind v4 — no `@theme inline` remap |
| `null`              | `--background`       | You own the namespace                  |

## Interpolation notes

- **Achromatic endpoints.** When one endpoint is a pure grey (`c: 0`, hue
  `none`) and the other is chromatic, the grey has no hue to contribute, so the
  chromatic endpoint's hue is used throughout. Fades to neutral therefore keep
  their colour cast rather than drifting toward an arbitrary hue.
- **Hue takes the shortest path** around the colour circle, so 350° → 10°
  crosses 0° rather than travelling backwards through 180°.
- **Only whole minutes are ever resolved** — `normalizeMinute` truncates. This
  is what makes `holdThenSnap()` exact rather than approximate.

Resolve a snapshot directly, without the DOM controller, for server-side
rendering or previews:

```ts
import { resolveThemeAt } from '@divypandya/time-aware-theme';

const snapshot = resolveThemeAt(system, 9 * 60); // 09:00
snapshot.appearance; // 'light'
snapshot.phase; // 'dawn'
snapshot.progress; // 0.42 - part-way to the next stop
snapshot.nextPhase; // 'morning'
snapshot.cssText; // '--background: oklch(...); --foreground: oklch(...);'
```

Test time-dependent behavior deterministically with the manual clock instead
of mocking `Date` and timers by hand:

```ts
import { createManualClock } from '@divypandya/time-aware-theme/testing';
import { createThemeController } from '@divypandya/time-aware-theme/dom';

const clock = createManualClock({ now: new Date('2026-08-12T06:00:00Z') });
const controller = createThemeController({ system, clock });

controller.start();
clock.advanceBy(60 * 60_000); // fast-forward one hour
controller.getSnapshot().phase;
```

## Presets

Four ready-made schedules, each certified across all 1,440 minutes in CI. Import
one granularly so you never bundle the others:

```ts
import dawnToDusk from '@divypandya/time-aware-theme/presets/dawn-to-dusk';

const controller = createThemeController({ system: dawnToDusk, document });
```

| Preset           | Level   | Character                                             |
| ---------------- | ------- | ----------------------------------------------------- |
| `dawn-to-dusk`   | AA      | Warm arc — indigo night, amber sunrise, ember dusk    |
| `tidal`          | AA      | Cool arc — cyan through slate, no warm hues           |
| `contrast-first` | **AAA** | 7:1 everywhere; time expressed via hue, not lightness |
| `paper`          | AA      | Near-achromatic surfaces, one chromatic accent        |

Each ships `background`, `foreground`, `surface`, `surfaceForeground`, `accent`
and `accentForeground`, with all three pairs declared as roles.

A full day of each, one frame per 15 minutes:

|                                                                                                                                                                                     |                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **dawn-to-dusk** — warm arc<br>![dawn-to-dusk cycling through a day](https://raw.githubusercontent.com/divypandya/time-aware-theme/main/assets/preset-dawn-to-dusk.gif)             | **tidal** — cool arc<br>![tidal cycling through a day](https://raw.githubusercontent.com/divypandya/time-aware-theme/main/assets/preset-tidal.gif)        |
| **contrast-first** — AAA everywhere<br>![contrast-first cycling through a day](https://raw.githubusercontent.com/divypandya/time-aware-theme/main/assets/preset-contrast-first.gif) | **paper** — near-achromatic<br>![paper cycling through a day](https://raw.githubusercontent.com/divypandya/time-aware-theme/main/assets/preset-paper.gif) |

Note how `contrast-first` barely changes lightness across the day — it carries
time of day in hue and chroma instead, because lightness is the budget contrast
spends.

Preset colours are public API: changing a value is a breaking change, and new
arcs ship under new names rather than as revisions. Backgrounds and accents are
authored by hand; every other token is solved for a contrast target and clamped
into the sRGB gamut by [scripts/generate-presets.mjs](scripts/generate-presets.mjs),
which refuses to emit anything it cannot certify.

## Tailwind v4

Generate the `@theme inline` mapping and static fallbacks instead of
hand-writing them:

```ts
import { tailwindCss } from '@divypandya/time-aware-theme/tailwind';

console.log(tailwindCss(system)); // paste into your stylesheet
```

If you set `cssVariablePrefix: 'color'` on the controller, the variables are
already in Tailwind's namespace and no `@theme inline` block is needed at all.

## Diagnostics

```ts
import {
  inspect,
  formatInspection,
  inspectSchedule
} from '@divypandya/time-aware-theme/inspect';

console.log(formatInspection(inspect(system, 16 * 60 + 33)));
```

```
16:33  afternoon -> dusk  t=0.512  light
  stops  15:00 (afternoon) -> 18:00 (dusk), 87 min to go
  tokens
    background         oklch(0.573 0.015 118 / 1)
    foreground         oklch(0.573 0.028 96 / 1)
  contrast
    foreground on background           1.00:1 / 4.5:1 FAIL
```

`inspectSchedule(system)` summarises a whole day, collapsing failures into
windows so a broken schedule reads as one window with a worst case rather than
ninety near-identical lines.

## React UI

Unstyled, structured components — no CSS ships with this package. State is
exposed through `data-*` attributes, so Tailwind's `data-[state=on]:` variants
or plain CSS attribute selectors are enough to style them:

```tsx
import { ThemeSelector } from '@divypandya/time-aware-theme/react-ui';

<ThemeSelector />;
```

`ThemeModeSelect`, `TimePreviewSlider` and `PhaseLabel` are also exported
individually. The mode selector is a proper radio group with roving tabindex,
the slider announces a wall-clock time rather than a bare number, and the phase
label is an `aria-live` region because the phase changes on its own.

## Examples

Runnable demo apps live under [examples/](examples), each with its own
README covering setup:

- [examples/vanilla-dom](examples/vanilla-dom) — zero-build, plain DOM +
  `createThemeController`, the source of the recording above.
- [examples/react](examples/react) — Vite + React app using
  `TimeAwareThemeProvider` / `useTimeAwareTheme`, consuming the package the
  same way a real installer would (`file:../..` dependency, not a relative
  `src` import).

## Entry points

- `@divypandya/time-aware-theme`
- `@divypandya/time-aware-theme/dom`
- `@divypandya/time-aware-theme/react`
- `@divypandya/time-aware-theme/react-ui`
- `@divypandya/time-aware-theme/testing`
- `@divypandya/time-aware-theme/inspect`
- `@divypandya/time-aware-theme/tailwind`
- `@divypandya/time-aware-theme/presets/{dawn-to-dusk,tidal,contrast-first,paper}`

## Public surface

**`.`** — `defineThemeSystem`, `holdThenSnap`, `resolveThemeAt`,
`resolveThemeSnapshot`, `serializeOklch`, `normalizeMinute`, `MINUTES_PER_DAY`
(plus `createThemeController` and `applySnapshotTo`, re-exported from `/dom`)

**`/dom`** — `createThemeController`, `applySnapshotTo`

**`/react`** — `TimeAwareThemeProvider`, `useTimeAwareTheme`

**`/react-ui`** — `ThemeSelector`, `ThemeModeSelect`, `TimePreviewSlider`,
`PhaseLabel`, `formatMinute`

**`/testing`** — `createManualClock`, `sampleSchedule`, `assertContrast`,
`findContrastViolations`, `contrastRatio`, `contrastThreshold`, `meetsContrast`,
`meetsWcagAA`, `relativeLuminance`, `isOutOfSrgbGamut`

**`/inspect`** — `inspect`, `inspectSchedule`, `formatInspection`,
`formatScheduleReport`

**`/tailwind`** — `tailwindCss`, `themeInlineCss`, `staticFallbackCss`

**`/presets/*`** — each preset is a default export plus a named export
(`dawnToDusk`, `tidal`, `contrastFirst`, `paper`)

## Runtime notes

- No runtime dependencies.
- React is an optional peer for the adapter entry point.
- The DOM controller is safe to construct without `window` or `document`; it simply becomes inert.
- The controller writes resolved theme tokens as CSS custom properties, toggles the `.dark` class, and updates `color-scheme`.
- WCAG and sRGB conversion maths lives only in the `/testing` and `/inspect`
  entries, so it never reaches core, dom, or the presets.
- Every schedule this repo ships passes a 1,440-minute WCAG sweep in CI
  (`npm run certify`).

## Non-goals

- No location access.
- No weather-based or network-driven theming.
- No user-defined schedules yet.
- No React-driven minute ticking.
