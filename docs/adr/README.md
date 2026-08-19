# Architecture Decision Records

Decisions for `@divypandya/time-aware-theme`, driven by the v0.1.0 integration
feedback from the agents-explorer team (Aug 2026).

| ADR                                            | Title                                                 | Status   | Feedback items |
| ---------------------------------------------- | ----------------------------------------------------- | -------- | -------------- |
| [0001](0001-continuous-interpolation-state.md) | Continuous interpolation state in ThemeSnapshot       | Proposed | #1, #2         |
| [0002](0002-contrast-safe-interpolation.md)    | Contrast-safe interpolation across role-swapped stops | Proposed | #8, #9, #11    |
| [0003](0003-scoped-controller-targeting.md)    | Scoped controller targeting and CSS variable naming   | Proposed | #3, #10        |
| [0004](0004-entry-point-topology.md)           | Entry point topology and dependency ordering          | Proposed | #4, #5, #7     |

## Dependency order

The single hardest constraint across these ADRs:

```
ADR-0002 Wave 1 (validation utilities)
    │
    ├──> ADR-0004 /inspect ──> debug overlay
    ├──> ADR-0004 /presets        (presets MUST NOT ship before this)
    └──> preset CI certification

ADR-0001 (progress/nextPhase)
    ├──> ADR-0004 /react-ui preview slider
    └──> ADR-0004 /inspect

ADR-0003 (scoped targeting)
    └──> ADR-0004 /react-ui preview swatch
```

Validation before anything that makes a claim about color.

## Related planning docs

- [design-system.md](../design-system.md) — token taxonomy, roles, CSS naming,
  the four presets
- [testing-strategy.md](../testing-strategy.md) — certification gate, property
  tests, coverage targets

## Key finding

`scripts/validate-palette.mjs` already runs a full 1,440-minute WCAG contrast
sweep in CI on every push — and has never been able to fail a build. It
`console.warn`s and returns clean, and its `culori` import is silently optional.
The invisible-text bug (#9) walked straight past a check designed to catch it.

Fixing enforcement is Action Item 1 of ADR-0002 and is close to free. It is worth
more than any other single item on the roadmap.

Running that sweep against our own reference fixture:

```
failing minutes: 166 of 1440 (11.5%)
  03:50–05:05   76min  min contrast 1.02 @ 04:27  (pre-dawn → dawn)
  15:49–17:18   90min  min contrast 1.00 @ 16:33  (afternoon → dusk)
worst: 16:33  contrast 1.003  bgL 0.573  fgL 0.573  ΔL 0.0002
```

The fixture everyone copies from renders invisible text for 90 minutes every
afternoon. Both windows are the role-swap crossing from #9 — the reported bug is
reproduced exactly by our own reference material.
