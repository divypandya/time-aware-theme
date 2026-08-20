# React example

Vite + React, wired to the package's React entry points. It deliberately shows
different things to [examples/vanilla-dom](../vanilla-dom):

|          | vanilla-dom                     | react                                                  |
| -------- | ------------------------------- | ------------------------------------------------------ |
| Wiring   | `createThemeController` by hand | `TimeAwareThemeProvider` + `useTimeAwareTheme`         |
| Controls | hand-written slider and buttons | the shipped `/react-ui` components                     |
| Schedule | one bespoke hand-authored day   | all ten presets, switchable at runtime                 |
| Proof    | prose                           | live contrast for every declared pair, from `/inspect` |

The contrast table is the interesting part: drag the slider to about 05:53 and
watch every ratio fall to just above its required level, then hold. That is the
switch, and it is the claim the package makes — checkable rather than asserted.

## Two things this example had to get right

**`dispose()` is terminal.** A controller built in `useMemo` and disposed by
StrictMode's second pass cannot be restarted, and the app dies with "Theme
controller has been disposed". So the controller is created inside the effect
that owns it — see [src/main.tsx](src/main.tsx).

**The slider is controlled.** `TimePreviewSlider` tracks its own minute by
default, which is fine until something else moves time too. The **Play 24h**
button does, so the app owns the minute and passes it down; otherwise the theme
would animate while the thumb sat still.

## Run it

```sh
# from the repo root
npm run build

# then, from this folder
cd examples/react
npm install
npm run dev
```

This example depends on the root package via `file:../..`, so it resolves the
same public entry points (`/dom`, `/react`, `/react-ui`, `/inspect`,
`/presets/*`) a real consumer installs from npm.
