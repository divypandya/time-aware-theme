# ADR-0003: Scoped controller targeting and CSS variable naming

**Status:** Accepted — implemented in v0.2.0
**Date:** 2026-08-16
**Deciders:** Divy Pandya (package author), Dipti Solanki
**Feedback items:** #10 (scoped/multi-instance theming), #3 (configurable CSS
variable naming)

## Context

`applyToDom` writes unconditionally to `doc.documentElement`
([`dom.ts:240`](../../src/dom.ts)) — CSS custom properties, the `.dark` class,
`color-scheme`, and two `data-theme-*` attributes. There is no way to theme a
subtree. A settings-panel preview swatch cannot show "here's what dusk looks
like" without repainting the entire application.

The integrating team worked around this by making the _whole app_ preview
together via the mode selector's slider. That works, but it means a preview
widget is impossible to build, and two independent theme instances on one page
are impossible outright.

Related, and in the same code path: variables are always written as
`--${prefix}-${key}` with `prefix` defaulting to `'tat'`. Every consumer has to
hand-remap `--tat-background` → `--color-background` in their own CSS. The
option accepts a `string` but has no bare-name mode.

Constraints:

- The controller is currently a singleton in practice — module-level `start()`,
  one `localStorage` key, and window-level event listeners for
  `visibilitychange`/`pageshow`/`focus`/`storage`.
- `root.dataset` and `root.style` require `HTMLElement`, not `Element`.
- `color-scheme` and `prefers-color-scheme` only behave correctly at the root;
  `color-scheme` on a nested element affects that subtree's form controls and
  scrollbars but not the page canvas.
- The `.dark` class on a subtree works fine with Tailwind's `dark:` variant only
  if Tailwind is configured for `selector`/`class` strategy — which is the same
  precondition already required at root.

## Decision

Add a `target?: HTMLElement` option defaulting to `doc.documentElement`, and
change `cssVariablePrefix` to accept `string | null`, where `null` means bare
`--${key}` passthrough.

Additionally, introduce an explicit notion of a **secondary (scoped) controller**
that does not persist mode, does not attach window listeners, and does not write
`color-scheme`. Scoped instances are for display, not for owning global state.

```ts
createThemeController({
  system,
  document,
  target: previewEl, // default: document.documentElement
  cssVariablePrefix: null, // default: 'tat'
  scoped: true // implied when target !== documentElement
});
```

## Options Considered

### Option A: `target` option, scoped instances are second-class

| Dimension   | Assessment                           |
| ----------- | ------------------------------------ |
| Complexity  | Low–Medium                           |
| Bundle cost | ~100 B                               |
| Breaking    | No                                   |
| Solves #10  | Yes, for the preview-widget use case |

Scoped controllers write vars + class to their element and nothing else. No
storage, no global listeners, no `color-scheme`.

**Pros:** Small, understandable, and matches the actual reported need (a preview
swatch). Avoids multiple controllers fighting over one `localStorage` key or
stacking duplicate `focus` listeners. Cheap to implement correctly.
**Cons:** Two subtly different behaviors under one factory function; the
distinction must be documented clearly or it will surprise people. A scoped
instance still runs its own minute timer unless we let it share a clock.

### Option B: Full peer multi-instance support

| Dimension   | Assessment                          |
| ----------- | ----------------------------------- |
| Complexity  | High                                |
| Bundle cost | ~400 B+                             |
| Breaking    | No, but changes lifecycle semantics |
| Solves #10  | Yes, more generally                 |

Every instance is equal: own storage key, own listeners, own timer.

**Pros:** Conceptually uniform. Supports genuinely independent themed regions
(e.g. a docs site previewing three themes side by side).
**Cons:** N controllers means N `focus`/`visibilitychange` listeners and N
minute timers, all firing simultaneously and all doing the same work. Needs a
shared scheduler to be responsible. Solves a problem nobody has reported yet.

### Option C: Separate `createScopedTheme()` factory

| Dimension   | Assessment             |
| ----------- | ---------------------- |
| Complexity  | Medium                 |
| Bundle cost | ~200 B, tree-shakeable |
| Breaking    | No                     |
| Solves #10  | Yes                    |

A distinct, smaller API for the preview case — applies a resolved snapshot to an
element, with no lifecycle at all.

**Pros:** Cleanest separation; the type signature tells the whole story. Nothing
to misconfigure. Genuinely tree-shakeable for consumers who don't preview.
**Cons:** Two factories to document and keep in sync. A preview that should
_track live time_ (rather than a fixed preview minute) would need its own ticking
anyway, pulling this back toward Option A.

## Trade-off Analysis

The reported need is specifically a **preview widget**: show a theme state in a
box without disturbing the page. That is a display concern, and display concerns
don't need persistence, don't need `focus` listeners, and actively should not
write `color-scheme` (which would alter form-control rendering in that subtree
for no good reason).

Option B's uniformity is appealing in the abstract but expensive in exactly the
dimension this package cares about — it currently runs one timer and a handful of
listeners, total, and that restraint is a feature. Multiplying that per preview
swatch on a settings page is a real regression for a use case nobody has asked
for.

Option A and Option C are closer than they first appear; the difference is
packaging, not capability. A is chosen because a preview that tracks live time is
a plausible near-term ask (the `/react-ui` selector in ADR-0004 may want a
live-updating swatch), and A gets there without a second factory. C's clarity is
partly recoverable by exporting a thin `applySnapshotTo(element, snapshot)`
primitive for the truly static case.

On `cssVariablePrefix: null` — this is unambiguously right and nearly free. The
only care needed is that bare mode makes collisions with consumer-defined
variables possible, so it should be documented as "you own the namespace now."
Type it as `string | null` rather than adding a separate boolean flag.

One subtlety worth flagging for implementation: `lastAppliedCssText` /
`lastAppliedAppearance` are closure-level memo variables. They are per-instance
already, so multiple controllers won't corrupt each other's memoization — but a
scoped controller pointed at an element that some _other_ controller also writes
to will thrash. Document that targets should not overlap.

## Consequences

**Easier:**

- Preview widgets, side-by-side theme comparisons, embedded docs demos.
- Consumers using `--color-*` conventions (Tailwind v4's own namespace) stop
  hand-remapping every token — this materially reduces the friction in #4.
- The `/react-ui` selector (ADR-0004) can render a live preview swatch.

**Harder:**

- Two controller "kinds" to document, test, and keep behaviorally coherent.
- Tests must cover: scoped instance does not write storage, does not attach
  window listeners, does not set `color-scheme`, and does not disturb `<html>`.
- Bare-prefix mode needs a collision warning in the docs.

**Revisit when:**

- If genuine peer multi-instance demand appears, revisit Option B — but require
  a shared scheduler so N instances still cost one timer.

## Action Items

1. [ ] Add `target?: HTMLElement` to `ThemeControllerOptions`, default
       `doc.documentElement`.
2. [ ] Derive `scoped` from `target !== doc.documentElement`; allow explicit override.
3. [ ] Gate storage persistence, window listeners, and `color-scheme` on `!scoped`.
4. [ ] Change `cssVariablePrefix` to `string | null`; `null` → bare `--${key}`.
5. [ ] Export `applySnapshotTo(element, snapshot, options)` primitive.
6. [ ] Tests: scoped instance leaves `<html>` untouched; two instances don't
       thrash each other's memoized `lastAppliedCssText`.
7. [ ] Document target non-overlap and bare-prefix collision risk.

## Implementation notes (v0.2.0)

Adopted as written. Implementing it surfaced an unrelated pre-existing bug:
`options.scheduler ?? createScheduler(win)` meant an explicit `scheduler: null`
— which the type permits — silently produced a real scheduler anyway, and the
same applied to `storage` and `window`. All three now distinguish `undefined`
from `null`. Found because a preview test could not pin the controller to a
manual clock.
