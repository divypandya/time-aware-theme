# Testing strategy

**Status:** Accepted — implemented in v0.2.0
**Date:** 2026-08-16
**Depends on:** [ADR-0001](adr/0001-continuous-interpolation-state.md),
[ADR-0002](adr/0002-contrast-safe-interpolation.md),
[ADR-0003](adr/0003-scoped-controller-targeting.md),
[ADR-0004](adr/0004-entry-point-topology.md),
[design-system.md](design-system.md)

## Current state

```
Test Files  4 passed (4)
     Tests  10 passed (10)      Duration 1.07s

core.ts     77.98% stmts  55.03% branch
dom.ts      75.17% stmts  69.30% branch
react.tsx   88.23% stmts  83.33% branch
testing.ts  90.55% stmts  90.90% branch
```

Ten tests for a package with a 644-line resolver, a 541-line DOM controller,
wrap-around interval logic, timezone handling, and OKLCH parsing. Coverage
thresholds are not configured, so nothing prevents this from declining. Example
apps and build scripts are included in the coverage report, which drags the
"all files" number to 50% and makes the real figure harder to see.

Branch coverage on `core.ts` — 55% — is the number that matters most. The
uncovered branches are concentrated in exactly the places bugs have been
reported: interpolation edge cases, achromatic hue borrowing, and wrap-around.

### The gap that matters

Every one of the twelve reported issues was found by a consumer, in production,
after release. Three of them (#1, #8, #9) were _detectable from the schedule
alone_ with no user interaction required. The test suite has no mechanism that
looks at a schedule as a whole — it asserts on individual resolved minutes,
chosen by hand.

The 1,440-minute sweep in `scripts/validate-palette.mjs` is the only whole-day
check, it warns instead of failing, and it currently emits 166 warnings per run
that nobody reads. **The strategy's central goal is to convert whole-schedule
properties from unobserved into enforced.**

## Test pyramid for this package

```
        ╱  Certification  ╲     presets + fixture, 1440-min sweep, CI-blocking
       ╱   Integration     ╲    controller ↔ DOM ↔ React, jsdom
      ╱     Property        ╲   invariants over generated schedules
     ╱       Unit            ╲  parsing, math, wrap-around, edge cases
```

The unusual tier is **certification** — a whole-artifact gate rather than a unit
of behavior. It is the tier that would have caught #9, and it is where the
package's credibility claims live.

## Layer 1 — Unit

Target: **core.ts ≥ 95% branch**, dom.ts ≥ 85% branch.

| Area                   | Cases                                                                  | Priority |
| ---------------------- | ---------------------------------------------------------------------- | -------- |
| OKLCH parsing          | `%` lightness, `turn`/`rad`/`grad` hue, `none`, alpha slash, malformed | P0       |
| `normalizeMinute`      | negative, > 1440, fractional truncation, non-finite throws             | P0       |
| Wrap-around            | interval spanning midnight; `next` at final stop wraps to `stops[0]`   | **P0**   |
| Achromatic hue (#12)   | c=0 ↔ chromatic in both directions; both endpoints c=0                 | **P0**   |
| Hue interpolation      | shortest-path across 0°/360°; exactly 180° apart                       | P1       |
| `progress`/`nextPhase` | static mode, single stop, exact hit, mid-interval, final-stop wrap     | **P0**   |
| Validation errors      | duplicate minutes, unsorted, missing/extra keys                        | P1       |

Wrap-around and achromatic are P0 because both are currently untested _and_
appear in the uncovered-line ranges of `core.ts` (`549-550`, `593-594`). #12 was
reported precisely because the behavior was undocumented and unverified — a
consumer had to read compiled source to learn it. A test is documentation that
cannot go stale.

## Layer 2 — Property-based

Add `fast-check` as a dev dependency. Generate arbitrary valid schedules
(1–24 stops, random minutes, random OKLCH) and assert invariants that must hold
for _every_ schedule — this is the layer that finds what hand-picked minutes miss.

| Invariant                                                                       | Catches                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `resolveThemeAt` never throws for any integer minute 0–1439                     | Interpolation producing out-of-gamut values that fail `validateAndFreezeOklch` |
| Output is continuous: `‖tokens(m) − tokens(m+1)‖` bounded by interval size      | Accidental discontinuities                                                     |
| `progress` ∈ [0,1], monotonically increasing within an interval, 0 at each stop | ADR-0001 regressions                                                           |
| At any exact stop minute, tokens equal that stop's tokens exactly               | Off-by-one in bracketing                                                       |
| Resolution is pure — same input, same output, no ordering effects               | Frozen-object mutation leaks                                                   |
| Schedule reversal symmetry: reversed schedule yields mirrored tokens            | Directional bugs in hue lerp                                                   |

The "never throws" property deserves emphasis. `interpolateOklch` calls
`validateAndFreezeOklch` on its result, so an interpolation that produces `l > 1`
or `c < 0` throws _at resolve time_ — in the consumer's browser, at a specific
minute of the day. That is a crash, not a visual bug, and no current test looks
for it.

## Layer 3 — Integration (jsdom)

| Area                            | Cases                                                                                                               | Priority |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| Controller → DOM                | vars written, `.dark` toggled, `color-scheme`, `data-theme-*`                                                       | P0       |
| **Scoped isolation** (ADR-0003) | scoped instance writes to target only; `<html>` untouched; no storage write; no window listeners; no `color-scheme` | **P0**   |
| Two instances                   | independent memoization; no cross-thrash of `lastAppliedCssText`                                                    | P1       |
| Bare prefix                     | `cssVariablePrefix: null` → `--background`; `'color'` → `--color-background`                                        | P0       |
| Minute ticking                  | `createManualClock` advance across a stop boundary re-renders                                                       | P0       |
| Timezone change                 | offset change mid-session reschedules correctly                                                                     | P1       |
| Lifecycle                       | `dispose()` removes all listeners and timers; `pendingTimers() === 0`                                               | **P0**   |
| Storage                         | corrupt value ignored; cross-tab `storage` event syncs mode                                                         | P1       |
| SSR safety                      | constructing without `document`/`window` stays inert, never throws                                                  | P0       |
| React adapter                   | subscription cleanup; no re-render when snapshot is value-equal                                                     | P1       |

`dispose()` leak-checking is P0 because the controller registers four window
listeners plus a timer, and the scoped-instance work in ADR-0003 multiplies
instances. `createManualClock.pendingTimers()` already exists and makes this
assertion a one-liner — it is simply never called in the current suite.

The "no re-render when value-equal" test guards ADR-0001's decision to keep
`progress` out of `ThemeControllerSnapshot`. Without it, a future contributor
adds the field, every consumer silently re-renders each minute, and nobody
notices for a release.

## Layer 4 — Certification (the blocking gate)

This replaces `validate-palette.mjs` and is the strategy's centerpiece.

For **every** schedule shipped or referenced by the repo — the fixture, all four
presets, both example apps — assert across all 1,440 integer minutes:

1. Every declared role pair meets its declared level (`AA` / `AA-large` /
   `non-text` / `AAA`).
2. No resolve throws.
3. Every token stays in sRGB gamut after conversion.
4. No sign change of `fg.l − bg.l` within any interval (the swap-lint from
   design-system.md — statically checkable, but verified by sampling too).

**These fail the build.** `process.exitCode = 1`, not `console.warn`.
`culori` becomes a hard dev dependency; a failed import fails the run rather
than silently skipping the check — the silent-skip path is how a passing run
could mean nothing.

Sampling every integer minute is exhaustive, not approximate: `normalizeMinute`
truncates, so integer minutes are the complete set of observable states. There is
no sub-minute state to miss, which is also why `holdThenSnap` is provably safe
rather than merely probably safe.

### Migration — this gate fails today

166 of 1,440 minutes fail on the current fixture (worst 1.003:1 at 16:33). Turning
the gate on without preparation red-lights `main`. Sequence:

1. Land the gate **skipped**, with the failure count printed as a baseline.
2. Re-author the fixture with `holdThenSnap` at both swap boundaries.
3. Re-run; expect 0 failures.
4. Enable the gate as blocking. No ratchet, no allowlist — a threshold that can
   be partially satisfied is one that gets partially ignored.

## Layer 5 — Consumer-facing utilities (`/testing`)

The integrating team hand-wrote a throwaway Node script to sample lightness delta
across a schedule. That script is the product. Ship it:

```ts
import { sampleSchedule, assertContrast, contrastRatio } from '.../testing';

it('never drops below AA', () => {
  assertContrast(mySystem, { level: 'AA' }); // throws with minute + ratio
});

it('has no invisible windows', () => {
  const failures = sampleSchedule(mySystem).filter(
    (s) => contrastRatio(s.tokens.background, s.tokens.foreground) < 4.5
  );
  expect(failures).toEqual([]);
});
```

Error messages must name the failing minute, the pair, the measured ratio, and
the two bracketing stops. "Contrast 1.00 at 16:33 (afternoon→dusk, t=0.51)"
points at the cause; "assertion failed" starts a debugging session.

The same functions back the certification gate, `inspect()`, and the debug
overlay. One implementation, four consumers — which is also why it is Wave 1 in
ADR-0004 and blocks everything else.

## Coverage targets & CI

| Module       | Stmts          | Branch  | Rationale                                |
| ------------ | -------------- | ------- | ---------------------------------------- |
| `core.ts`    | 95%            | **95%** | Pure, fully testable, where the bugs are |
| `dom.ts`     | 90%            | 85%     | Some browser paths are awkward in jsdom  |
| `react.tsx`  | 90%            | 85%     | Small surface                            |
| `testing.ts` | 95%            | 90%     | Consumers depend on it being correct     |
| `/presets`   | 100% certified | —       | Gate, not line coverage                  |

Configure these as **thresholds in `vitest.config.ts`** so they block rather than
inform. Exclude `examples/**` and `scripts/**` from the report — they currently
depress the aggregate and obscure the real numbers.

CI additions to `.github/workflows/ci.yml`:

```
npm run test -- --coverage      # with enforced thresholds
npm run certify                 # replaces validate:palette, blocking
npm run size                    # existing; add budgets per new entry point
```

## Priority sequence

1. **Certification gate + fixture repair** — closes a shipping accessibility
   defect and the bug class behind #9.
2. **`/testing` utilities** — same code as (1); unblocks all of ADR-0004.
3. **`core.ts` branch coverage to 95%** — wrap-around, achromatic, `progress`.
4. **Scoped-isolation + lifecycle-leak tests** — before ADR-0003 ships, not after.
5. **Property-based layer** — highest long-term value, lowest urgency.
6. **Coverage thresholds in config** — ratchet shut so this doesn't recur.

## Explicit non-goals

- **No visual regression / screenshot testing.** Output is deterministic OKLCH
  values; asserting on numbers is strictly better than on pixels.
- **No E2E browser automation.** jsdom covers the DOM contract; the resolver is
  pure. A real browser adds minutes of CI for no new failure mode.
- **No testing of example apps' UI.** They are documentation. Their _schedules_
  are certified (Layer 4); their components are not.

## Implementation notes (v0.2.0)

All five layers landed. 144 tests, up from 10.

Coverage thresholds are set as a ratchet just below what the suite achieves,
rather than at the aspirational targets stated above — a threshold the suite
does not meet is one that gets lowered rather than met. `core.ts` sits at 93.7
percent statements and 87.5 percent branches against a stated target of 95
percent branches; the remaining gap is defensive throws that need malformed
frozen state to reach.

The certification gate covers six schedules: the fixture, both examples, and all
four presets.
