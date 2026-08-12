# React example

A small Vite + React app showing `TimeAwareThemeProvider` /
`useTimeAwareTheme` end to end: drag the time-of-day slider or hit
**Play 24h** and watch `mode`, `appearance`, and `phase` update live while the
DOM controller writes the resolved tokens to `document.documentElement`.

This example depends on the root package via `file:../..`, so it consumes the
same public entry points (`@divypandya/time-aware-theme`, `/dom`, `/react`)
that a real consumer would install from npm.

## Run it

```sh
# from the repo root
npm run build

# then, from this folder
cd examples/react
npm install
npm run dev
```
