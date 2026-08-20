# ADR-0001: Expose continuous interpolation state in ThemeSnapshot

**Status:** Accepted — implemented in v0.2.0
**Date:** 2026-08-16
**Deciders:** Divy Pandya (package author), Dipti Solanki
**Feedback items:** #1 (continuous appearance), #2 (phase label interpolation)

## Context

`resolveThemeAt()` computes `t` (progress between bracketing stops) at
[`core.ts:167`](../../src/core.ts), uses it to interpolate every token, and then
**throws it away**. The returned `ThemeSnapshot` carries only
`appearance: 'light' | 'dark'` and `phase`, both copied verbatim from the
_previous_ stop.

The consequence is a mismatch in continuity: token colors move smoothly minute
by minute, but `appearance` and `phase` are step functions that flip at the
exact stop boundary. Any consumer using raw Tailwind `dark:` classes — which is
most real apps, since 100% token migration is rarely realistic — gets a hard
visual flip regardless of how smooth the underlying palette is.

Forces at play:

- The information already exists; we compute `t` and discard it. This is a
  disclosure problem, not a computation problem.
- `appearance` must keep a binary form. It drives `classList.toggle('dark')` and
  the CSS `color-scheme` property, neither of which accepts a fraction.
- The package is pre-1.0 with a 4.5 KB gzip budget on `dist/index.js`
  (enforced in CI by `npm run size`). Additive fields on a returned object cost
  approximately nothing; new code paths cost bytes.
- `ThemeControllerSnapshot` is a deliberately narrower type than `ThemeSnapshot`
  — the controller emits `{ mode, appearance, phase }` only, and diffs on those
  three fields to decide whether to notify subscribers
  ([`dom.ts:406`](../../src/dom.ts)). Adding a continuously-varying field to
  that snapshot would make `snapshotEquals` false on nearly every tick.

## Decision

Add `progress`, `nextPhase`, and `nextAppearance` to `ThemeSnapshot`. Keep
`appearance` and `phase` binary and previous-stop-derived exactly as they are
today. Do **not** add `progress` to the controller's emitted
`ThemeControllerSnapshot` by default; expose it through a separate opt-in
subscription instead.

```ts
interface ThemeSnapshot<TPhase> {
  // unchanged
  mode: ThemeMode;
  appearance: ThemeAppearance;
  phase: TPhase | 'static';
  minute: number;
  tokens: Readonly<Record<string, OklchColor>>;
  cssText: string;
  // new
  progress: number; // 0..1 through the current stop interval
  nextPhase: TPhase | 'static';
  nextAppearance: ThemeAppearance;
}
```

For static (`light`/`dark`) modes and exact-stop hits, `progress` is `0`,
`nextPhase === phase`, and `nextAppearance === appearance`. This keeps the field
total — consumers never branch on `undefined`.

## Options Considered

### Option A: Add `progress`/`nextPhase`/`nextAppearance` to `ThemeSnapshot` only

| Dimension   | Assessment                                   |
| ----------- | -------------------------------------------- |
| Complexity  | Low — surface three values already in scope  |
| Bundle cost | Negligible (~40 B); no new math              |
| Breaking    | No — purely additive                         |
| Solves #1   | Yes, for consumers who opt in to crossfading |
| Solves #2   | Yes                                          |

**Pros:** Cheapest possible change. No behavioral difference for existing users.
Gives consumers everything needed to build a crossfade, a countdown label, or a
progress-driven CSS variable. Keeps one binary `appearance` for the `.dark`
class so nothing downstream breaks.
**Cons:** Consumers must write the crossfade themselves; we hand them a number,
not a solution. Doesn't fix the abrupt flip for anyone who doesn't opt in.

### Option B: Make `appearance` itself continuous (`appearanceValue: 0..1`)

| Dimension   | Assessment                              |
| ----------- | --------------------------------------- |
| Complexity  | Medium                                  |
| Bundle cost | Low                                     |
| Breaking    | Yes — or forces an awkward second field |
| Solves #1   | Yes, more directly                      |
| Solves #2   | No                                      |

**Pros:** Most faithful to the ask ("expose a blendFactor"). One concept instead
of three fields.
**Cons:** `appearance` has exactly two consumers in our own code — the `.dark`
toggle and `color-scheme` — and both need a hard boolean. We'd end up deriving
a binary from the continuous value anyway, at which point we've just renamed
Option A's `progress` and lost the phase information (#2). Also strictly worse
for the very common case of "I just want to know if it's dark right now."

### Option C: Emit a transition event with progress, rather than a snapshot field

| Dimension   | Assessment                  |
| ----------- | --------------------------- |
| Complexity  | High — new eventing concept |
| Bundle cost | Medium                      |
| Breaking    | No                          |
| Solves #1   | Yes                         |
| Solves #2   | Partially                   |

**Pros:** Lets the controller drive an animation at rAF cadence rather than
minute cadence, which is what a genuinely smooth crossfade wants.
**Cons:** Introduces a second, parallel notification channel next to
`subscribe()`. Pushes us toward running rAF continuously, which is a battery and
CPU cost the package has so far deliberately avoided (it currently schedules one
timer per minute). Large surface area for a problem Option A addresses.

## Trade-off Analysis

The central tension is **who owns the crossfade** — us or the consumer.

Owning it (Options B/C) means running an animation loop, which conflicts with
the package's current and rather admirable resource profile: one `setTimeout`
per minute, rAF used only for preview scrubbing. Turning that into a persistent
rAF loop to animate a class boundary would be a significant regression in idle
cost for a purely cosmetic benefit.

Handing over the number (Option A) means a consumer who wants a crossfade writes
about five lines of CSS driving `opacity` off a custom property. That is a
reasonable amount of work to ask of someone who has already opted into a
time-aware theming library, and it keeps the door open — if crossfading turns
out to be near-universal, we can add a `crossfade: true` convenience on top of
Option A later without redesigning anything.

The `nextAppearance` field is what actually unblocks the reported bug: knowing
that the theme is 80% of the way from a dark stop to a light stop is what lets a
consumer start fading their `dark:`-classed surfaces early, rather than being
ambushed at the boundary minute.

Deliberately keeping `progress` out of `ThemeControllerSnapshot` matters more
than it first appears. That snapshot is diffed by value to suppress redundant
subscriber notifications; a field that changes every minute (or every rAF during
preview) would defeat that entirely and cause a React re-render on every tick
for every consumer, including those who never asked for progress. Consumers who
want it subscribe explicitly and accept the re-render cost.

## Consequences

**Easier:**

- Crossfading the `.dark` boundary becomes possible at all.
- Phase countdown UI ("sunset in 12 min") becomes possible.
- The preview slider in the planned `/react-ui` kit (ADR-0004) has real data to
  render a progress indicator from.
- `inspect()` (ADR-0004) becomes mostly a formatting layer over these fields.

**Harder:**

- Three more fields to keep correct across the static-mode, single-stop,
  exact-hit, and wrapping-interval code paths. All four need test coverage.
- `nextPhase` at the last stop of the day must wrap to `stops[0]`, matching the
  wrapping logic already in `findBracketingStops`. Easy to get subtly wrong.

**Revisit when:**

- If most consumers end up writing the same crossfade CSS, promote it to a
  built-in option.
- If the rAF-cadence transition (Option C) is genuinely needed for smoothness at
  sub-minute granularity, revisit — but measure the idle cost first.

## Action Items

1. [ ] Add `progress`, `nextPhase`, `nextAppearance` to `ThemeSnapshot`.
2. [ ] Populate in all four `resolveThemeAt` paths + `resolveThemeSnapshot`
       static path.
3. [ ] Verify wrap-around: `nextPhase` at the final stop returns `stops[0].phase`.
4. [ ] Add `subscribeProgress()` (or documented opt-in) to the controller,
       separate from `subscribe()`.
5. [ ] README: crossfade recipe, with a `prefers-reduced-motion` guard.
6. [ ] Confirm `npm run size` still passes the 4,608 B budget.

## Implementation notes (v0.2.0)

Two deviations from this ADR as written:

1. **At an exact stop minute, `nextPhase` points at the _following_ stop**, not
   at the current one. This ADR specified `nextPhase === phase` there, arguing
   only for field totality. In practice that produces a one-minute blip where a
   countdown reads "night" while sitting on the night stop. Sitting on a stop
   means sitting at the _start_ of the interval it opens, so the sawtooth stays
   continuous: progress approaches 1, resets to 0, and `nextPhase` advances in
   the same tick.

2. **`nextPhase` and `nextAppearance` were added to `ThemeControllerSnapshot`**,
   which this ADR deliberately kept narrow. The reasoning here still holds for
   `progress` — it varies every minute and would defeat `snapshotEquals`,
   re-rendering every consumer on every tick. But `nextPhase` and
   `nextAppearance` are discrete: they change only at stop boundaries, exactly
   like `phase` and `appearance` already do. Excluding them forced the
   `/react-ui` phase label to alias `nextPhase` to `phase`, which is a
   dishonest API. `progress` remains out.
