# ADR-0002: Contrast-safe interpolation across role-swapped stops

**Status:** Accepted — implemented in v0.2.0
**Date:** 2026-08-16
**Deciders:** Divy Pandya (package author), Dipti Solanki
**Feedback items:** #9 (contrast collapse — confirmed user-facing bug), #11
(contrast validation as a dev tool), #8 (authoring-time validation)

## Context

When a stop with a dark background and light foreground interpolates toward a
stop with a light background and dark foreground, both tokens travel linearly
through OKLCH space and **cross each other** near `t = 0.5`. At the crossing the
lightness delta collapses; the integrating team measured ~0.005 at the midpoint
of a 60-minute window. That is genuinely invisible text, shipped to users, for
several minutes a day.

This is not theoretical and it is not a consumer authoring error. It is the
mathematically inevitable result of independently lerping two values that
started on opposite sides of each other. The workaround the integrating team
found — hand-deriving "hold, then jump one minute later" stops by computing the
OKLCH lerp themselves in a throwaway script — is exactly the kind of thing a
theming library exists to prevent.

### The uncomfortable finding

`scripts/validate-palette.mjs` **already sweeps all 1,440 minutes computing WCAG
contrast** between `background` and `foreground`, and it **already runs in CI on
every push** (`.github/workflows/ci.yml`). It did not catch this bug for three
compounding reasons:

1. It calls `console.warn` on a sub-4.5:1 result and never sets `process.exitCode`.
   The job goes green. The warning scrolls past in log output nobody reads.
2. `culori` is a `try`/`catch` optional import. If resolution fails, the entire
   contrast block is silently skipped and the script still prints its reassuring
   "Validation fixture sampled for all 1,440 minutes."
3. It only ever runs against `createFixtureSystem()` — our own internal fixture.
   A consumer's theme is never checked by anything.

So the detection logic was right, present, and running. It was the _enforcement_
and _reach_ that were missing. This materially changes the shape of this ADR:
the work is less "build a contrast checker" and more "make the existing one
capable of failing, and put it in consumers' hands."

There is no `roles` or contrast concept anywhere in `src/` — it exists only in
that one build script.

## Decision

Adopt a three-layer approach, in this order:

1. **Make the existing sweep enforce.** Fail the build on sub-threshold contrast;
   make `culori` a hard dev dependency (it already is one) and remove the silent
   skip. Non-negotiable and near-free.
2. **Ship the sweep to consumers** as `assertContrast()` / `sampleSchedule()` in
   `/testing`, plus WCAG utilities in core. Consumers gate their own themes in
   their own CI.
3. **Add an optional `roles` declaration** to `defineThemeSystem` for token pairs
   that must maintain contrast, and ship a `holdThenSnap()` authoring helper.
   Defer automatic contrast-preserving interpolation (see Trade-off Analysis).

## Options Considered

### Option A: Documentation + `holdThenSnap()` authoring helper

| Dimension          | Assessment                                        |
| ------------------ | ------------------------------------------------- |
| Complexity         | Low                                               |
| Bundle cost        | ~150 B (helper is authoring-time, tree-shakeable) |
| Correctness risk   | Low — deterministic, inspectable output           |
| Fixes reported bug | Yes, if the author uses it                        |

Productizes the integrating team's own workaround: a helper that expands one
declaration into the two stops (hold, then snap one minute later) they derived
by hand.

**Pros:** Zero new color math in the hot path. Output is plain stops the author
can read and reason about. Composes with everything. Impossible to be subtly
wrong in a way that ships invisible text.
**Cons:** Opt-in — an author who doesn't know about the crossing problem still
writes the broken schedule. Trades a smooth transition for an abrupt one at the
swap point, which is a real (if small) aesthetic regression.

### Option B: Automatic contrast-preserving interpolation via declared roles

| Dimension          | Assessment                          |
| ------------------ | ----------------------------------- |
| Complexity         | High                                |
| Bundle cost        | ~400–800 B in the resolver hot path |
| Correctness risk   | **High**                            |
| Fixes reported bug | Yes, automatically                  |

Author declares `roles: { foreground: 'foreground', background: 'background' }`;
the resolver detects an impending crossing and reshapes the interpolation curve
(e.g. easing one token through the swap faster) to hold a minimum delta.

**Pros:** Correct by default. The author does nothing and never hits the bug.
Strongest possible version of the guarantee.
**Cons:** Perceptual contrast is not lightness delta — a genuine WCAG-correct
guarantee requires OKLCH→sRGB conversion and relative-luminance math _in the
resolver_, which is currently pure, dependency-free, and benchmarked at
median < 1 ms. That's a meaningful bundle and latency cost on every resolve.
Worse, "reshape the curve to preserve contrast" has no single right answer — you
can hold, ease, or push apart, and each produces different and possibly ugly
color. A subtly wrong implementation here ships _wrong colors_ silently, which
is a strictly worse failure mode than the current _documented_ one.

### Option C: Validation only — detect and warn, never alter output

| Dimension          | Assessment                             |
| ------------------ | -------------------------------------- |
| Complexity         | Low                                    |
| Bundle cost        | 0 in runtime (dev/test only)           |
| Correctness risk   | Very low                               |
| Fixes reported bug | Only if the author acts on the warning |

**Pros:** Catches the bug at authoring time with certainty and no runtime cost.
Directly addresses #8 and #11. Honest — we tell the truth and let the author
decide.
**Cons:** Doesn't fix anything by itself. Given that a warning-only check is
_precisely_ what already failed us, shipping another warning-only check without
enforcement would be repeating the mistake.

## Trade-off Analysis

The decisive consideration is **failure mode asymmetry**.

Option B's failure mode is "the library silently produces colors the author
didn't author." Option A's failure mode is "the author sees an abrupt but
legible transition." For a theming package, silently-wrong color is far more
corrosive to trust than a visible, documented seam — especially since the author
can see and edit the stops `holdThenSnap()` generates, but cannot see inside a
curve-reshaping algorithm.

This is reinforced by how the bug reached production in the first place. The
failure was **enforcement, not detection**. Adding a sophisticated automatic
correction while the existing check still can't fail a build would be building
the roof before fixing the foundation. Layer 1 is worth more than Layer 3 and
costs a fraction as much.

Roles are still worth adding in this cycle, but for _validation targeting_
rather than for altering interpolation: `assertContrast` needs to know which
pairs matter, and so does the debug overlay (#11) and the preset test suite
(ADR-0004). Declaring roles now means Option B remains available later as a pure
addition — the data model won't need to change, only the resolver behavior.

One honest caveat on thresholds: WCAG 4.5:1 is a floor for body text, and a
schedule that technically clears it at every sampled minute can still look bad.
Sampling at 1-minute granularity is exact for our purposes since the controller
only ever resolves integer minutes — there is no sub-minute state to miss.

## Consequences

**Easier:**

- The bug class becomes a failing test instead of a bug report.
- Consumers get the sweep the integrating team hand-wrote, as a supported API.
- Presets (ADR-0004) can be certified contrast-safe in CI before shipping.
- `inspect()` and the debug overlay have a real contrast model to report against.

**Harder:**

- Turning warnings into failures may break our own CI immediately. That is the
  point, but it needs a triage pass on the existing fixture first.
- `roles` adds a concept to `defineThemeSystem` that authors must learn.
- WCAG math means OKLCH→sRGB conversion. Keep it in `/testing`, **not** in core,
  to protect the 4.5 KB budget and the sub-1 ms resolve benchmark.

**Revisit when:**

- If authors consistently forget `holdThenSnap`, reconsider Option B as an
  opt-in `interpolation: 'contrast-safe'` flag — never as a silent default.

## Action Items

1. [ ] `validate-palette.mjs`: set `process.exitCode = 1` on sub-threshold contrast.
2. [ ] Remove the silent `culori` skip — fail loudly if it can't be imported.
3. [ ] Audit the current fixture against a hard 4.5:1 gate; fix what this surfaces.
4. [ ] Add `contrastRatio()` / `meetsWcagAA()` to `/testing` (not core).
5. [ ] Add `sampleSchedule(system, { stepMinutes })` to `/testing`.
6. [ ] Add optional `roles` to `defineThemeSystem` — validation targeting only.
7. [ ] Add `holdThenSnap()` authoring helper.
8. [ ] Document the crossing behavior and the recommended authoring pattern.
9. [ ] Document achromatic (`c=0`) hue borrowing at the same time (#12) — same
       section, same reader.

## Implementation notes (v0.2.0)

Adopted as written. The migration in Action Item 3 was larger than anticipated:
the fixture failed 166 of 1,440 minutes and the vanilla-dom example a further
132, so "audit the fixture" became a re-authoring of every shipped schedule.

Option B (automatic contrast-preserving interpolation) remains unimplemented and
unneeded so far. `holdThenSnap` proved exact rather than heuristic, because
`normalizeMinute` truncates and a one-minute gap therefore has no sampleable
interior at all.
