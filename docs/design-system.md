# Token architecture & preset design

**Status:** Accepted — implemented in v0.2.0
**Date:** 2026-08-16
**Depends on:** [ADR-0002](adr/0002-contrast-safe-interpolation.md) (roles),
[ADR-0003](adr/0003-scoped-controller-targeting.md) (bare prefix),
[ADR-0004](adr/0004-entry-point-topology.md) (`/presets` entry point)

## Audit: current state

The package has no token taxonomy. `defineThemeSystem` accepts an arbitrary
`Record<string, OklchInput>` and enforces only that every stop declares exactly
the same keys as `staticThemes.light`. Both our fixture and the React example
independently converged on `background` / `foreground` / `accent` — a naming
convention that exists by coincidence, not by design.

| Category          | Defined        | Findings                                                              |
| ----------------- | -------------- | --------------------------------------------------------------------- |
| Token keys        | 0 prescribed   | 3 conventional (`background`, `foreground`, `accent`), unenforced     |
| Roles / pairs     | 0              | No fg↔bg relationship expressible; contrast script hardcodes the pair |
| Naming            | `--tat-${key}` | No bare mode; every consumer hand-remaps to `--color-*`               |
| Semantic states   | 0              | No surface/muted/border/danger vocabulary                             |
| Certified presets | 0              | Consumers author every OKLCH value from scratch                       |

### The audit finding that matters

Running the existing CI contrast sweep against our own reference fixture:

```
failing minutes: 166 of 1440 (11.5%)
  03:50–05:05   76min  min contrast 1.02 @ 04:27  (pre-dawn → dawn)
  15:49–17:18   90min  min contrast 1.00 @ 16:33  (afternoon → dusk)
worst: 16:33  contrast 1.003  bgL 0.573  fgL 0.573  ΔL 0.0002
```

At 16:33 the foreground and background lightness differ by 0.0002. That is not
low contrast; it is _the same color_. Our reference fixture — the artifact that
demonstrates how to use this package — renders invisible text for 90 consecutive
minutes every afternoon, and has done so through every green CI run.

Both windows are exactly the role-swap crossing from feedback #9. This is not a
consumer authoring mistake. It is the default outcome of the documented approach,
and the design system's first job is to make it unrepresentable.

**Score: 34/100** — the resolver is sound; the token layer above it is absent.

## Principle: contrast is a property of pairs, not tokens

A token has no contrast. `oklch(0.57 0.02 260)` is neither readable nor
unreadable until you know what it sits on. Yet the current model treats tokens as
independent values that happen to be interpolated side by side — which is
precisely why they can cross without anything noticing.

The fix is to make the _pair_ a first-class declared object. Roles are not
decoration; they are the unit the validator, the inspector, and the preset
certification all operate on.

## Token taxonomy

Three tiers. Only Tier 1 is required — the package must stay usable for someone
who wants two colors and a clock.

### Tier 1 — Core (required, 4 keys)

| Key                | Role | Description                       |
| ------------------ | ---- | --------------------------------- |
| `background`       | bg   | Page canvas                       |
| `foreground`       | fg   | Primary body text on `background` |
| `accent`           | bg   | Primary interactive/brand surface |
| `accentForeground` | fg   | Text on `accent`                  |

### Tier 2 — Recommended (8 keys)

| Key                 | Role | Description                    |
| ------------------- | ---- | ------------------------------ |
| `surface`           | bg   | Raised panels, cards, popovers |
| `surfaceForeground` | fg   | Text on `surface`              |
| `muted`             | bg   | Subdued fills, disabled states |
| `mutedForeground`   | fg   | Secondary/caption text         |
| `border`            | line | Dividers, input outlines       |
| `ring`              | line | Focus indicator                |
| `danger`            | bg   | Destructive surface            |
| `dangerForeground`  | fg   | Text on `danger`               |

### Tier 3 — Consumer-defined (open)

Any additional keys. Unpaired tokens are permitted and simply skipped by contrast
validation — with a dev-mode notice listing them, so "I forgot to declare the
pair" is distinguishable from "this token is decorative by intent."

### Naming convention

`camelCase` keys; a foreground paired to surface `x` is named `xForeground`.
This is enough for `defineThemeSystem` to _infer_ most pairs, with explicit
`roles` as the override. Inference should suggest, never silently assume — a
dev-mode message ("inferred 3 pairs; declare `roles` to silence") keeps it
honest.

## Role declaration

```ts
defineThemeSystem({
  staticThemes: {/* ... */},
  roles: {
    pairs: [
      { bg: 'background', fg: 'foreground', min: 'AA' }, // 4.5:1
      { bg: 'surface', fg: 'surfaceForeground', min: 'AA' },
      { bg: 'accent', fg: 'accentForeground', min: 'AA' },
      { bg: 'background', fg: 'mutedForeground', min: 'AA-large' }, // 3:1
      { bg: 'background', fg: 'border', min: 'non-text' } // 3:1
    ]
  },
  stops: [/* ... */]
});
```

| Level      | Ratio | Applies to                                |
| ---------- | ----- | ----------------------------------------- |
| `AAA`      | 7:1   | High-accessibility presets                |
| `AA`       | 4.5:1 | Body text — the default                   |
| `AA-large` | 3:1   | ≥18.66px or ≥14px bold; secondary text    |
| `non-text` | 3:1   | Borders, focus rings, icons (WCAG 1.4.11) |

Distinguishing `AA-large` and `non-text` matters more than it looks. Holding
`border` to 4.5:1 against its background would force borders so dark they read
as rules rather than edges — a real design regression in service of a standard
that doesn't apply to non-text content. Getting this wrong produces validators
people disable, which is worse than no validator.

## CSS variable naming

Per ADR-0003, `cssVariablePrefix: string | null`:

| Value             | Output               | Use when                                    |
| ----------------- | -------------------- | ------------------------------------------- |
| `'tat'` (default) | `--tat-background`   | Namespace safety; mixing with other systems |
| `null`            | `--background`       | You own the namespace                       |
| `'color'`         | `--color-background` | Tailwind v4 native namespace — no remapping |

`'color'` deserves a call-out in the docs. Tailwind v4's `@theme` block already
uses `--color-*`, so a consumer choosing that prefix gets `bg-background`
working with **zero** `@theme inline` remapping — which removes most of the pain
behind feedback #4 without the plugin even being installed. The plugin then
becomes an optimization rather than a prerequisite.

## The structural rule: role swaps must snap, never lerp

The crossing bug has a clean structural fix that requires no color math.

`normalizeMinute()` applies `Math.trunc`, so **the resolver only ever evaluates
integer minutes** — during live ticking and during preview scrubbing alike.
Therefore two stops one minute apart have _no sampleable interior_. The
interpolation between them is never observed.

```
17:00  appearance: light   bg L 0.95   fg L 0.20    ✅ 15.1:1
17:01  appearance: dark    bg L 0.22   fg L 0.95    ✅ 14.8:1
       └─ no integer minute exists between them; the crossing is unobservable
```

Compare the fixture's current 90-minute lerp through the swap, which passes
through ΔL 0.0002. The `holdThenSnap()` helper (ADR-0002) generates exactly this
pair from one declaration:

```ts
holdThenSnap({
  at: 17 * 60,
  from: eveningTokens,
  to: nightTokens,
  fromAppearance: 'light',
  toAppearance: 'dark',
  phase: 'evening',
  nextPhase: 'night'
});
```

**Authoring rule:** within a single stop-to-stop interval, the sign of
`fg.l − bg.l` must not change. Every appearance swap is a snap. This is
statically checkable at `defineThemeSystem` time — no sampling required — and
should be a dev-mode error, not a warning.

This rule is what makes the presets certifiable rather than merely tested.

## The four presets

Shared structure — six phases, swaps only at the two `holdThenSnap` boundaries:

| Phase       | Minute               | Appearance       |
| ----------- | -------------------- | ---------------- |
| `night`     | 0                    | dark             |
| `dawn`      | 300                  | dark             |
| `sunrise`   | 390 → **snap 391**   | dark → **light** |
| `midday`    | 720                  | light            |
| `afternoon` | 990                  | light            |
| `dusk`      | 1140 → **snap 1141** | light → **dark** |

### 1. `dawn-to-dusk` — warm arc (default)

Amber sunrise, neutral-warm midday, deep indigo night. The recommended starting
point; closest to the existing fixture's intent but structurally sound.

|              | night           | sunrise        | midday          | dusk            |
| ------------ | --------------- | -------------- | --------------- | --------------- |
| `background` | `0.16 0.03 265` | `0.97 0.03 70` | `0.99 0.01 95`  | `0.20 0.05 300` |
| `foreground` | `0.95 0.02 265` | `0.20 0.03 60` | `0.17 0.02 95`  | `0.95 0.02 300` |
| `accent`     | `0.72 0.15 300` | `0.70 0.17 45` | `0.62 0.16 250` | `0.74 0.16 330` |

### 2. `tidal` — cool arc

Cyan-to-slate; no warm hues. For products where amber reads as a warning color.
Hue range 190°–280° throughout, which keeps `danger` (~25°) unambiguous.

### 3. `contrast-first` — accessible

Every pair certified at **AAA (7:1)** across all 1,440 minutes. Near-white and
near-black endpoints; time-of-day expressed through _hue and chroma_ rather than
lightness, since lightness is the budget contrast spends. Proves the schedule can
shift perceptibly without ever trading away legibility — and is the preset to
reach for in regulated or public-sector contexts.

### 4. `paper` — minimal achromatic

`c ≤ 0.02` on all surface tokens; accent is the only chromatic token. Exercises
the achromatic hue-borrowing path (#12) as a _documented, tested_ behavior rather
than something discovered by reading compiled source — the preset doubles as the
worked example for that section of the docs.

### Preset contract

- **Granular exports** (`/presets/dawn-to-dusk`), never a barrel — one preset
  must not bundle four.
- **Colors are public API.** Changing a value is a breaking change; new arcs ship
  under new names, not as revisions.
- **CI-certified.** Each preset passes its declared level across all 1,440
  minutes, for every declared pair, on every push. A preset that cannot pass does
  not ship — this is the claim that makes the collection worth having.

## Priority actions

1. **Fix the fixture** — it fails 11.5% of the day at 1.00:1. Re-author with
   `holdThenSnap` at both swaps; it is the example everyone copies.
2. **Ship `roles`** — nothing downstream (validation, inspector, presets) can be
   built without it.
3. **Static swap-lint** in `defineThemeSystem` — catches the entire bug class at
   authoring time, no sampling needed.
4. **Document `cssVariablePrefix: 'color'`** — largest DX win per byte of work.
5. **Author the presets last**, once 1–3 make certification meaningful.

## Open questions

- Do `roles` belong on `ThemeSystem` or as a separate argument to the validator?
  On the system means presets carry their own contract, which argues for it.
- Should inferred pairs validate by default, or only explicit ones? Inferring and
  validating silently risks failing a build over a token the author never
  intended as a pair.
- Is `AA` the right default floor, or should presets target `AA` while the
  validator defaults to warning-only for consumer themes until they opt in?

## Implementation notes (v0.2.0)

Adopted, with the token set narrowed. Presets ship the Tier 1 core plus
`surface`/`surfaceForeground` — six tokens, three declared role pairs — rather
than the full Tier 2 vocabulary. Tier 2's `muted`, `border` and `ring` remain
specified but unshipped; they are additive when a consumer needs them.

The "role swaps must snap, never lerp" rule is enforced by `defineThemeSystem`
rather than merely documented, and the audit findings recorded above are fixed:
the fixture and both examples now certify clean.
