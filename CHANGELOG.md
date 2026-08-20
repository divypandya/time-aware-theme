# Changelog

All notable changes to this package are documented here.

This project follows [Semantic Versioning](https://semver.org/). While the
package is pre-1.0, minor versions may contain breaking changes.

## 0.4.2 — 2026-08-20

Documentation only. **No code changes** — `dist` is byte-identical to 0.4.1, so
there is nothing to gain by upgrading unless you read the package page.

### Documented

- The playground link moved above the fold. It shipped in 0.4.1 but sat below
  the badges, the intro, the recording and the whole stats table, which on
  npm means most readers never reach it. It is now the first actionable thing
  on the page.

  npm renders the README from the published tarball, so a link added to the
  repository does not appear on the package page until something is published.
  Hence a release for a one-paragraph move.

- The intro still said the package ships four palettes. It ships ten.

## 0.4.1 — 2026-08-20

### Fixed

- **A disposed controller no longer throws at whoever calls it next.**
  `setMode`, `setPreviewMinute` and `clearPreview` are now no-ops once
  `dispose()` has run, rather than raising "Theme controller has been
  disposed".

  This was a real crash, not a tidiness point. An animation loop holding
  `setPreviewMinute` keeps running for a frame or two after a controller is
  swapped out, and the throw propagated far enough to unmount an entire React
  tree — switching theme during a play-through-the-day took the page blank.
  StrictMode's double-invoke had already caught the same edge once, and the
  advice then was "create the controller inside the effect", which treats the
  symptom.

  `start()` still throws. A disposed controller cannot be revived, and silently
  doing nothing there would hide a genuine mistake rather than a teardown race.

  If you were relying on the throw to detect use-after-dispose, the snapshot is
  unchanged and `getSnapshot()` still works, so compare that instead.

### Added

- **A live playground**, at
  [divypandya.github.io/time-aware-theme](https://divypandya.github.io/time-aware-theme/):
  all ten presets, scrubbable across a day, with every declared contrast pair
  computed live. Swatches tell you what the colours are; they do not tell you
  whether a table is comfortable to read at 4am, so it themes a small real
  interface instead of a palette.

### Notes

The examples had `--tat-accent-foreground` and `--tat-surface-foreground` in
their stylesheets. The controller writes `--tat-accentForeground` and
`--tat-surfaceForeground` — token keys are used verbatim, not kebab-cased — so
those declarations resolved to nothing and silently inherited the page
foreground. On an accent-filled button in light mode that meant near-black text
on a mid-dark fill. Fixed in all three example stylesheets; the shipped package
was never affected, since it emits the names rather than consuming them.

## 0.4.0 — 2026-08-20

**Preset colours changed in every shipped preset.** That contradicts the rule
this README has carried since 0.1 — that preset values are public API and new
arcs ship under new names — and it is deliberate. 0.3.0's presets stepped half
the background's entire daily range at the switch, and protecting the rule
would have meant leaving that in. Pin an exact version if you depend on
specific values. The rule stands again from here.

### The finding

0.3.0 shipped on the claim that a light-to-dark transition cannot be gradual.
That is still true of the _text_. It is not true of the page, and the note in
0.3.0 pointing at the fix had the direction backwards.

The forbidden band the background has to cross is

```
gap = t * (Y_darkText + 0.05) - (Y_lightText + 0.05) / t
```

which shrinks as the two text colours move **apart**, not together. Solving
each foreground for the nearest lightness reaching 9:1 had put them at L=0.395
and L=0.755 — comfortably mid-range, and the worst possible place. Pinning them
near black and near white closes the band almost entirely, and closes it
completely once `t² ≤ 21`:

| Level    | t²    | Continuous glide possible |
| -------- | ----- | ------------------------- |
| AA-large | 9     | yes, with room            |
| AA       | 20.25 | yes, just                 |
| AAA      | 49    | **no, ever**              |

So `contrast-first` keeps a visible step for as long as it is AAA. That is now
a property of the ratio rather than an observation about a palette.

### Changed

- **Every preset re-tuned.** Text sits near the ends of the lightness range;
  accent lightness is solved rather than authored; the switch is where the
  solver puts it. Background step at the switch:

  | Preset           | 0.3.0 | 0.4.0         |
  | ---------------- | ----- | ------------- |
  | `dawn-to-dusk`   | 0.412 | 0.032 – 0.038 |
  | `tidal`          | 0.456 | 0.032         |
  | `paper`          | 0.435 | 0.026 – 0.032 |
  | `contrast-first` | 0.795 | 0.264 – 0.265 |

  The background travels about 0.84 across a day, so the AA presets now step
  under 4% of their own range — the page glides through a grey dawn instead of
  cutting from night to morning. The text still inverts instantly and always
  will: gliding it would carry it through mid-grey while the page is mid-grey.

- **Accents keep one polarity all day.** In 0.3.0 `accentForeground` was the
  single largest jump in every AA preset — 0.659 in lightness, larger than the
  page itself — while the accent under it moved 0.146. A primary button
  inverting at dusk is not something anyone asked for, and it cost more than
  the page change did. The generator now refuses to emit a preset whose accent
  changes polarity across phases.

- **Accent lightness is solved, not authored.** Hue and chroma are the design
  decision and are kept exactly; lightness is what contrast is spent from. An
  accent authored at L=0.5 is the worst case for carrying text at all — white
  reaches 4.4:1 on it and black 4.8:1, so neither clears 6:1.

### Added

Six presets, bringing the total to ten:

| Preset     | Character                                                    |
| ---------- | ------------------------------------------------------------ |
| `nocturne` | Eye-comforting — warm dim night, midday short of paper white |
| `ember`    | Deep amber throughout; lamplight rather than daylight        |
| `forest`   | Muted green and moss, low chroma                             |
| `meridian` | Neutral and quiet; hue barely moves, only the light does     |
| `blossom`  | Soft rose and plum; lightest by day, tinted at night         |
| `slate`    | Cool blue-grey, restrained accent, for dense interfaces      |

`nocturne` is the one to reach for in a dark room: blue light is carried by hue
rather than by the lightness contrast is spent from, so a warm night costs
nothing in legibility. Its daytime ceiling of 0.93 instead of 0.985 is the real
concession, and it buys the smallest step of any preset — 0.024.

### Also

- **`TimePreviewSlider` accepts a controlled `minute` / `onMinuteChange`.** It
  tracked its own minute outright, which is fine until something else moves
  time too - the React example's play-through-the-day button being the obvious
  case. Driving the theme worked; moving the thumb did not, so the control
  showed one time while the page showed another.

- **The React example was rebuilt.** It had become the vanilla example with
  JSX around it, demonstrating nothing about the React entry points. It now
  uses the shipped `/react-ui` controls, switches between all ten presets at
  runtime, and shows live contrast for every declared pair from `/inspect` -
  so the package's central claim is checkable by dragging a slider rather than
  asserted in prose.

  Building it surfaced one thing worth knowing: `dispose()` is terminal, so a
  controller created in `useMemo` and disposed by StrictMode's second pass
  cannot be restarted, and the app dies with "Theme controller has been
  disposed". Create it inside the effect that owns it.

### Notes

Two palettes had to move for reasons that are worth recording, because both
are properties of sRGB rather than taste. `tidal`'s night accents were cyan,
and dark saturated cyan does not exist — fitting them for white text pushed 24
interpolated samples out of gamut, so its accent arc now sits in the blues.
`forest` leans toward teal as it darkens for the same reason.

All ten presets are certified per second — 86,400 samples each, every declared
pair — and the rendered-path check runs over all of them.

## 0.3.0 — 2026-08-20

Driven by a second round of integration feedback, and by one larger complaint:
that transitions between stops still felt "abrupt and discrete instead of a
smooth continuous function".

That complaint turned out to have a definite answer, and it is not the one
anyone wants. A light-to-dark transition **cannot** be made gradual. Contrast
is a ratio, so the set of legible background/foreground pairs has two
disconnected halves — light-on-dark and dark-on-light — and any continuous path
from one to the other passes through the gap where nothing is readable. We
measured the alternatives before accepting this: carrying the change in chroma
and hue instead of lightness tops out at **1.2:1** against the 4.5 that AA
needs.

So the theme still steps. What changed is that it now steps as little as the
maths allows, at a moment computed rather than chosen, and everything around
that step got sharper.

### Added

- **`/solve` — a new build-time entry point.**

  `solveSchedule` takes a plain curve with no `appearance` and works out where
  the theme has to change polarity and by how little. Backgrounds glide the
  whole way; foregrounds hold and change once, at the last minute the outgoing
  set is still legible. Output is ordinary stops, so the resolver is unchanged
  and hand-written schedules keep working.

  `extendPreset` adds tokens to an already-certified schedule without dropping
  them outside that guarantee. Foregrounds pinned with `{ on: 'surface' }` are
  solved at every stop and declare their own role pair; supplied arcs must
  appear in a role or be marked `decorative: true`. Supplied colours are
  checked, never adjusted — quietly repainting a brand colour to reach a ratio
  is worse than reporting that it does not reach one.

- **A transition contract for the frame at the step.** The controller sets
  `data-theme-flip` on its target for the frame in which a declared jump
  applies, so a stylesheet can suppress the animation across exactly that
  change:

  ```css
  [data-theme-flip] * {
    transition: none !important;
  }
  ```

  `tailwindCss()` now includes this rule; `transitionCss()` emits it alone.
  This closes a live defect: with `transition: background-color .35s` the
  browser fades straight through the crossing, painting **1.02:1 for roughly
  100ms**, while every gate stayed green. The resolver was spotless and the
  screen was not. `assertRenderedPath()` now checks those in-between frames.

- **Sub-minute resolution.** `resolveThemeAt(system, 331.5)` is a real answer,
  the controller ticks sub-minute where a schedule needs it, and
  `assertContrast(system, { stepMinutes: PER_SECOND })` sweeps 86,400 samples.

- **Fix directions on contrast failures.** Every violation now carries the
  smallest lightness change that clears the bar, per token, per direction, in
  the units the stops are written in. Directions that cannot get there are
  marked rather than omitted, and shared tokens are flagged with the other
  pairs that use them.

- **`maxChromaInGamut(l, h)` and `clampChromaToGamut(color)`**, from
  `/testing`. The bisection already existed inside the preset generator, where
  nobody using the package could reach it.

- **`parseOklch`**, the missing half of a pair that has been lopsided since
  0.1 — `serializeOklch` was public while the direction people actually need
  was not.

- **Hold windows in `inspectSchedule()`**, reported on passing schedules too.
  Every legible light/dark theme has at least one step, it is the one moment a
  user notices, and a report that stays silent about it is hiding its most
  interesting minute.

### Changed

- **All four presets regenerated through the solver.** Phase durations now come
  from the curve rather than from wherever the switch happened to land:

  ```
  before   night 10.0h  dawn 1.5h  sunrise 5.5h  midday 4.5h  afternoon 2.5h  dusk 0.0h
  after    night  7.0h  dawn 2.0h  sunrise 5.0h  midday 4.5h  afternoon 3.5h  dusk 2.0h
  ```

  The `dusk` phase previously held its label for a single minute in all four
  presets — it existed only as the snap stop. And the step itself is much
  smaller, because it is now computed instead of assumed:

  | Preset           | Step before | Step after (dawn / dusk) |
  | ---------------- | ----------- | ------------------------ |
  | `dawn-to-dusk`   | 0.735       | 0.412 / 0.365            |
  | `tidal`          | 0.735       | 0.456 / 0.420            |
  | `paper`          | 0.735       | 0.435 / 0.418            |
  | `contrast-first` | 0.845       | 0.795 / 0.784            |

  `contrast-first` barely improves, and that is structural rather than a
  shortfall: AAA requires the background to travel from dark enough for light
  text all the way to light enough for dark text in one step, which with its
  own text colours is nearly the whole range. If you want the smallest possible
  step, it is the wrong preset.

  Token values changed throughout. Visually this is the same four themes with
  the same character; if you have screenshot tests against preset output, they
  will need regenerating.

- **`normalizeMinute` no longer truncates.** This is the substantive breaking
  change. Before 0.3 the entire crossing guarantee rested on truncation: two
  stops a minute apart had no sampleable interior, so the crossing could not be
  rendered. That worked and was brittle — sampling any finer reintroduced the
  bug, and it did, with **38 of 61 seconds** between two such stops below AA
  once we looked. Safety now comes from `jumpAfter` being declared on the stop,
  which holds at any resolution.

  Schedules built with `holdThenSnap()` are migrated automatically: a
  one-minute gap between stops that swap appearance is read as a declared jump.
  Schedules that relied on truncation some other way are not, and
  `defineThemeSystem` will tell you which stop pair is the problem.

- **`ThemeStopInput` gains `jumpAfter`; `ThemeSnapshot` gains `holding`.**

- **Contrast certification runs per second**, and additionally checks the
  frames a CSS transition would paint between resolved values.

### Fixed

- **Text went invisible for about 100ms at every switch, on screen, in a build
  where every gate was green.** `assertContrast` proves each resolved moment is
  legible and says nothing about the frames a CSS transition paints between
  them; with `transition: background-color .35s` the browser fades straight
  through the crossing at roughly 1.02:1. Our own demo did this. Fixed by the
  `data-theme-flip` contract above, and caught from now on by
  `assertRenderedPath()`, which is part of `npm run certify`.

  If you animate your custom properties and do not adopt the CSS rule, this
  defect is still present in your app. It is the one thing in this release
  worth acting on immediately.

### Notes on size

The DOM entry grew from ~5.2 KB to ~5.6 KB gzipped against a 6.5 KB budget,
which is the transition contract and the hold state. `/solve` is build-time and
carries the luminance maths; call it at module scope, not per request. Nothing
new reaches the presets or core.

## 0.2.1 — 2026-08-17

Documentation only. **No code changes** — `dist` is byte-identical to 0.2.0, so
there is nothing to gain by upgrading unless you read the package page.

### Fixed

- The README's animations pointed at relative `assets/…` paths. npm renders the
  README from the published tarball, and `files` ships only `dist`,
  `README.md`, `CHANGELOG.md` and `LICENSE.md`, so those paths resolved to
  nothing and npmjs.com showed five broken images. They now point at
  `raw.githubusercontent.com`. GitHub was unaffected either way, which is why
  it went unnoticed.

  Adding `assets` to `files` would also have worked, but ships ~3.5MB of GIFs
  to every consumer for images only the package page needs.

### Documented

- Regenerated the demo animation, which still showed the pre-0.2.0 schedule —
  including the windows where foreground and background crossed and text became
  invisible. The front page was demonstrating the bug 0.2.0 fixed.
- Added an animation per shipped preset, and `npm run demo:gif` to regenerate
  them all from a headless browser running the real controller.

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
