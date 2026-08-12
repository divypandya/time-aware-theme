# @divypandya/time-aware-theme

Time-aware theme resolution, a DOM controller, a lightweight React adapter, and deterministic testing utilities.

## Entry points

- `@divypandya/time-aware-theme`
- `@divypandya/time-aware-theme/dom`
- `@divypandya/time-aware-theme/react`
- `@divypandya/time-aware-theme/testing`

## Public surface

- `defineThemeSystem`
- `resolveThemeAt`
- `resolveThemeSnapshot`
- `serializeOklch`
- `createThemeController`
- `TimeAwareThemeProvider`
- `useTimeAwareTheme`
- `createManualClock`

## Runtime notes

- No runtime dependencies.
- React is an optional peer for the adapter entry point.
- The DOM controller is safe to construct without `window` or `document`; it simply becomes inert.
- The controller writes resolved theme tokens as CSS custom properties, toggles the `.dark` class, and updates `color-scheme`.

## Startup order

Create and start the controller before mounting React so the first paint already reflects the correct theme.

```ts
const controller = createThemeController({ system });
controller.start();
createRoot(container).render(
  <TimeAwareThemeProvider controller={controller}>
    <App />
  </TimeAwareThemeProvider>
);
```

## Non-goals

- No location access.
- No weather-based or network-driven theming.
- No user-defined schedules in v0.1.0.
- No React-driven minute ticking.
