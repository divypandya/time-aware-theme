# Vanilla DOM example

A zero-build demo of `createThemeController` driving the real DOM: it writes
`--tat-*` CSS custom properties, toggles `.dark`, and updates `color-scheme`
on `document.documentElement` as you drag the time-of-day slider or hit
**Play 24h**.

## Run it

This example imports directly from `../../dist` (no bundler), so serve it
from the **repo root** — not from this folder — so that path resolves.

```sh
# from the repo root
npm run build
npx serve .
# or: python3 -m http.server
```

Then open `http://localhost:<port>/examples/vanilla-dom/`.
