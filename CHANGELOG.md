# Changelog

All notable changes to this package are documented here.

This project follows [Semantic Versioning](https://semver.org/). While the
package is pre-1.0, minor versions may contain breaking changes.

## 0.2.0 — 2026-08-16

Driven by integration feedback from the agents-explorer team, who reported
twelve issues after adopting v0.1.0.

The headline is a real accessibility defect. When a stop with a dark background
and light text interpolated toward a stop with a light background and dark
text, both tokens travelled through OKLCH space and **crossed each other**
partway — at which point their lightness was identical and body text became
invisible, for as long as the interval was wide. Every schedule this repo
shipped had it, including the reference fixture (166 of 1,440 minutes below
WCAG AA, worst 1.003:1) and the demo recorded in the README (132 minutes, worst
1.00:1).

A contrast sweep had been running in CI on every push for the lifetime of the
package. It could not fail a build: it called `console.warn` without ever
setting an exit code, and its `culori` import was optional, so a run that
checked nothing printed the same success line as a run that passed. Detection
was present and correct; enforcement was absent.

### Breaking

- `ThemeSnapshot` gains `progress`, `nextPhase` and `nextAppearance`.
- `ThemeControllerSnapshot` gains `nextPhase` and `nextAppearance`.

  Both are additive, so reading existing properties is unaffected. Code that
  constructs either type, or exhaustively matches its keys, must be updated.

- An explicit `scheduler: null`, `storage: null` or `window: null` passed to
  `createThemeController` now genuinely disables that default. Previously
  `??` treated an explicit `null` as "unset" and handed back the very default
  the caller was refusing. Anyone depending on the old behaviour was depending
  on a bug, but the observable result changes.

### Added

**Contrast safety**

- `roles` on `defineThemeSystem`, declaring which token pairs carry a
  foreground-on-background relationship, at `AAA`, `AA`, `AA-large` or
  `non-text`. Roles never alter interpolation — they are validation targeting.
- An authoring-time lint that **rejects** role swaps a consumer can observe.
  Because `normalizeMinute` truncates, only whole minutes are ever resolved, so
  a swap spanning a single minute has no sampleable interior and is permitted.
- `holdThenSnap()`, expanding a swap into a hold stop and a snap stop one
  minute later. This is the workaround the integrating team derived by hand.
- A dev-mode warning when stops revisit a handful of palettes — the "five stops
  but only two phases render" defect. Deliberate holds and the cycle closing
  are not counted.

**New entry points**

- `/testing` extended with `sampleSchedule`, `assertContrast`,
  `findContrastViolations`, `contrastRatio`, `meetsWcagAA`, `meetsContrast`,
  `contrastThreshold`, `relativeLuminance` and `isOutOfSrgbGamut`. The OKLCH to
  linear-sRGB conversion is implemented in-package to preserve zero runtime
  dependencies; it agrees with `culori` to 1.6e-6 percent for in-gamut colours.
- `/inspect` — `inspect()` reports the active stop pair, progress, resolved
  tokens, gamut status and per-pair contrast at one minute.
  `inspectSchedule()` sweeps a day and collapses failures into windows.
- `/tailwind` — generates the v4 `@theme inline` mapping from the system's own
  token keys, plus static `:root` and `.dark` fallbacks so a server-rendered
  page is styled before hydration.
- `/presets/{dawn-to-dusk,tidal,contrast-first,paper}` — four schedules,
  exported granularly. `contrast-first` certifies at AAA; the rest at AA.
  Backgrounds and accents are authored by hand; every other token is solved for
  a contrast target and gamut-clamped by a generator that refuses to emit
  anything it cannot certify.
- `/react-ui` — headless `ThemeSelector`, `ThemeModeSelect`,
  `TimePreviewSlider` and `PhaseLabel`. No stylesheet ships and no inline
  styles are set; state is exposed through `data-*` attributes. The mode
  selector is a radio group with roving tabindex, the slider announces a
  wall-clock time via `aria-valuetext`, and the phase label is an `aria-live`
  region because the phase changes without user action.

**Controller**

- `target` — write CSS variables and the `.dark` class to any element instead
  of `documentElement`, enabling preview swatches and side-by-side comparisons.
  Scoped instances are display-only: no persisted mode, no window listeners, no
  `color-scheme`.
- `cssVariablePrefix` now accepts `string | null`. `null` emits bare
  `--background`; `'color'` emits `--color-background`, which is Tailwind v4's
  native namespace and needs no `@theme inline` remapping at all.
- `applySnapshotTo()` for a one-off write with no lifecycle attached.

### Fixed

- **Invisible text in every shipped schedule.** The validation fixture and both
  example apps are re-authored with declared roles and `holdThenSnap` at each
  appearance swap. All now certify clean across 1,440 minutes.
- Out-of-gamut token values in the examples (233 occurrences in vanilla-dom).
- The README quick-start taught the exact pattern that produced the bug. It now
  teaches the corrected one, verified by running it rather than by inspection.
- `npm run size` measured almost nothing once code splitting was enabled: with
  shared chunks an entry file is a few hundred bytes of re-exports. It now
  walks each entry's imports transitively and gzips the concatenation, which is
  what a consumer actually downloads.

### Changed

- `scripts/validate-palette.mjs` is replaced by `scripts/certify.mjs`, which
  sets an exit code, treats `culori` as required, and certifies six schedules —
  the fixture, both examples and all four presets — across every integer
  minute, including static fallbacks.
- Coverage thresholds now block rather than inform, set as a ratchet just below
  what the suite achieves.
- Test suite grew from 10 tests to 144, adding negative-path parsing and
  validation coverage, scoped-controller isolation, lifecycle leak checks, and
  a property-based layer over generated schedules.

### Documented

- Achromatic (`c = 0`) hue borrowing, shortest-path hue travel, and
  whole-minute resolution — previously discoverable only by reading compiled
  source.

## 0.1.0

Initial release: time-aware OKLCH resolver, DOM controller, React adapter and
manual-clock testing utilities.
