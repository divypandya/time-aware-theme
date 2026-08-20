# ADR-0004: Entry point topology and dependency ordering

**Status:** Accepted — implemented in v0.2.0
**Date:** 2026-08-16
**Deciders:** Divy Pandya (package author), Dipti Solanki
**Feedback items:** #4 (Tailwind v4 plugin + presets), #5 (ship the UI), #7/#11
(dev diagnostics), plus preset collection and web component from brainstorm

## Context

The package ships four entry points today — `.`, `/dom`, `/react`, `/testing` —
all bundled by `tsup` from `src/`, all ESM-only, with zero runtime dependencies
and per-bundle gzip budgets enforced in CI (4,608 B core, 3,072 B dom, 1,024 B
react).

The feedback asks for four more surfaces: a Tailwind v4 plugin, a preset theme
collection, a React UI kit, and dev diagnostics. Adding these naively threatens
three things the package currently gets right: zero runtime dependencies, small
enforced bundles, and a coherent public API.

The dependency relationships between the proposed additions are not obvious and
matter a great deal for sequencing:

- **Presets are themes**, so they must be _proven_ contrast-safe — which means
  they depend on the validation utilities from ADR-0002. Shipping presets before
  enforcement exists risks shipping the exact bug (#9) the presets are meant to
  demonstrate we've solved. This is the single most important ordering constraint
  in the roadmap.
- **The debug overlay** (#11) renders contrast warnings, so it depends on the
  same utilities, plus `progress`/`nextPhase` from ADR-0001.
- **The React UI kit's preview slider** needs `progress` (ADR-0001) and, for a
  non-destructive preview swatch, scoped targeting (ADR-0003).
- **The Tailwind plugin** needs only `tokenKeys`, which already exists. It is the
  most independent piece and could ship first — but it is much more valuable
  alongside presets, since its main pain point ("hand-authoring every OKLCH
  value") is only half solved by codegen.

## Decision

Add five entry points, in three waves, ordered by dependency rather than by
demand:

| Entry point                                           | Wave | Runtime deps          | Budget (gzip)                 |
| ----------------------------------------------------- | ---- | --------------------- | ----------------------------- |
| `/testing` (extend: `sampleSchedule`, contrast utils) | 1    | 0                     | 2 KB                          |
| `/inspect` (`inspect()`, contrast reporting)          | 2    | 0                     | 2 KB                          |
| `/tailwind` (v4 plugin, `@theme inline` codegen)      | 2    | 0 (peer: tailwindcss) | 2 KB                          |
| `/presets` (certified theme collection)               | 3    | 0                     | 1 KB/preset, granular exports |
| `/react-ui` (unstyled `<ThemeSelector>` etc.)         | 3    | 0 (peer: react)       | 4 KB                          |

Deferred: the debug **overlay** (visual) and the web component — both are
additive on top of `/inspect` and can follow without further architectural
decisions.

`culori` stays a dev dependency only. WCAG math lives in `/testing` and
`/inspect`, never in core (ADR-0002).

## Options Considered

### Option A: Separate entry points per concern (chosen)

| Dimension         | Assessment                  |
| ----------------- | --------------------------- |
| Complexity        | Medium                      |
| Bundle discipline | Strong — per-entry budgets  |
| Tree-shaking      | Excellent                   |
| Consumer clarity  | Good, with a documented map |

**Pros:** A consumer importing only `.` pays nothing for presets, UI, or
diagnostics. Peer dependencies stay scoped to the entry that needs them
(`tailwindcss` for `/tailwind`, `react` for `/react-ui`). Each surface gets its
own CI budget line, so growth is visible.
**Cons:** Eight entry points is a lot of surface to document and version. Risk of
a consumer not discovering the one they need. `tsup` config, `exports` map, and
`size-check.mjs` budgets all grow in lockstep and can drift.

### Option B: Monorepo with separately versioned packages

| Dimension         | Assessment |
| ----------------- | ---------- |
| Complexity        | High       |
| Bundle discipline | Strong     |
| Release overhead  | High       |
| Consumer clarity  | Good       |

`@divypandya/time-aware-theme-tailwind`, `-presets`, `-react-ui` as siblings.

**Pros:** Independent versioning — a breaking change to the UI kit doesn't force
a core major. Clearer ownership boundaries if contributors appear. Consumers
install exactly what they use.
**Cons:** Serious overhead for a package at v0.1.0 with a single maintainer —
workspace tooling, cross-package version constraints, N release pipelines, and
the perennial problem of a preset package depending on a core version range.
Presets and core will move together for the foreseeable future, so the
independence is mostly theoretical.

### Option C: Fold everything into existing entry points

| Dimension         | Assessment |
| ----------------- | ---------- |
| Complexity        | Low        |
| Bundle discipline | **Poor**   |
| Tree-shaking      | Fragile    |
| Consumer clarity  | Poor       |

**Pros:** Nothing new to configure. One import path to teach.
**Cons:** Puts presets and WCAG conversion math in the path of every consumer,
blowing the 4.5 KB core budget immediately. Would force either raising the budget
(abandoning a genuine selling point) or relying on tree-shaking to save us —
which is fragile for side-effectful plugin registration and object-literal preset
data. Non-starter.

## Trade-off Analysis

The real question is **when** to take on monorepo overhead, not whether Option A
or B is better in the abstract. B is where this lands if the UI kit grows or
outside contributors appear; A is correct while one person maintains all of it
and everything versions together. Option A does not foreclose B — entry points
can be extracted into packages later with a deprecation shim, and doing so is
much easier than un-splitting a premature monorepo.

The sequencing decision deserves more weight than the packaging one. The
temptation is to build `/tailwind` and `/presets` first because they are the most
visible, most demo-able wins and the most directly requested. That ordering is
backwards. Presets are a _claim_ — "these palettes are good and safe" — and we
currently have no mechanism capable of substantiating that claim, since the one
contrast check we have cannot fail a build (ADR-0002). Shipping a preset that
goes invisible at 17:43 would be considerably worse for the package's credibility
than shipping no presets at all.

Hence: validation utilities first (Wave 1), diagnostics and codegen second
(Wave 2), and only then the things that make claims about color (Wave 3).

On preset scope specifically — four presets is the right number. Enough to show
range (a warm day/night arc, a cool one, a high-contrast accessible one, a
minimal near-achromatic one), few enough that each can be genuinely designed and
individually contrast-certified rather than generated and hoped over. They should
be exported granularly (`/presets/dawn-to-dusk`, not a barrel) so a consumer
using one doesn't bundle four, and they should be versioned in name (a preset's
colors are a public contract; changing them is breaking).

On `/react-ui` — "unstyled but structured" needs a concrete convention, not just
an intention. Headless components with `data-*` state attributes and no CSS
imports is the established pattern (Radix, Headless UI) and is what consumers
will expect. The 4 KB budget is generous relative to the rest of the package and
should be treated as a ceiling to design against, not a target to fill.

## Consequences

**Easier:**

- Each new surface has an enforced budget, so growth is visible in CI rather than
  discovered by a consumer.
- Presets become a credibility asset — "every preset passes a 1,440-minute WCAG
  AA sweep in CI" is a genuinely strong claim, and one no competitor makes.
- The web component and debug overlay become additive follow-ups needing no
  further architectural decisions.

**Harder:**

- `tsup` entries, the `exports` map, `size-check.mjs` budgets, and the README
  entry-point list must all stay in sync — four places, easy to drift. Worth a
  test that asserts every `exports` key has a budget.
- Peer dependency matrix grows (`react`, `tailwindcss`, both optional).
- Preset color values become a public API surface with breaking-change semantics.

**Revisit when:**

- Extract to a monorepo (Option B) if `/react-ui` grows beyond ~4 KB, if outside
  contributors take ownership of a surface, or if preset and core release
  cadences genuinely diverge.

## Action Items

1. [ ] **Wave 1:** extend `/testing` with `sampleSchedule`, `contrastRatio`,
       `meetsWcagAA`, `assertContrast` (blocks everything else).
2. [ ] **Wave 2:** `/inspect` with `inspect()` returning stop pair, progress,
       resolved tokens, and contrast flags.
3. [ ] **Wave 2:** `/tailwind` plugin generating `@theme inline` from `tokenKeys`;
       `tailwindcss` as optional peer.
4. [ ] **Wave 3:** `/presets` — four presets, granular exports, each certified by
       the Wave 1 sweep in CI.
5. [ ] **Wave 3:** `/react-ui` — headless, `data-*` state attributes, no CSS import.
6. [ ] Add budget lines to `size-check.mjs` for every new entry, at creation time.
7. [ ] Add a test asserting every `exports` key has a corresponding budget entry.
8. [ ] Deferred, no ADR needed: debug overlay, web component.

## Implementation notes (v0.2.0)

Three deviations:

1. **Code splitting is enabled.** This ADR assumed the existing
   `splitting: false`, which would have inlined the resolver into each of the
   four preset bundles. Sharing a chunk is the better trade, but it invalidated
   the size gate: with splitting, `dist/index.js` is a ~250-byte file of
   re-exports while the real code sits in chunks it imports, so every budget
   would have passed while measuring almost nothing. `size-check.mjs` now walks
   each entry's imports transitively and gzips the concatenation. Budgets are
   restated against those numbers, which is why they look larger.

2. **Presets are generated, not hand-authored.** This ADR said four presets
   "can be genuinely designed and individually contrast-certified rather than
   generated and hoped over". That framing was wrong: hand-authoring is exactly
   how the original bug happened. Only the background and accent arcs are a
   human decision; the rest is solved for a contrast target and gamut-clamped by
   `scripts/generate-presets.mjs`, which refuses to emit anything it cannot
   certify. CI regenerates and diffs, so a preset cannot drift from its spec.

3. **The debug overlay and web component remain deferred**, as anticipated.

Two colour-science findings are now encoded in the generator: choosing text
colour by whether the base is above or below L=0.5 is wrong for mid-lightness
colours (an accent at L=0.50 reaches 6.33:1 against white but 3.27:1 against
black), and interpolating between two in-gamut OKLCH colours can leave the sRGB
gamut, because the gamut is not convex in that space.
