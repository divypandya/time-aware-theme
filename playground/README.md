# Playground

The live site: **https://divypandya.github.io/time-aware-theme/**

All ten presets, scrubbable across a day, with every declared contrast pair
computed live. It exists because swatches answer the wrong question — they tell
you what the colours are, not whether a table is comfortable to read at 4am —
so the page themes a small but real interface rather than a palette.

Scrub to around 05:53 and watch the ratios fall to just above their required
level, then hold: that is the switch, and the contrast table makes the
package's central claim checkable rather than asserted.

`?preset=nocturne` selects a preset, so a link carries the theme with it.

## Run it

```sh
# from the repo root
npm run build

# then
npm ci --prefix playground
npm run dev --prefix playground
```

The playground depends on the root package through `file:../`, so it resolves
the same public entry points a real consumer installs — which is why the root
build has to run first.

## Deploying

`.github/workflows/pages.yml` builds and publishes on every push to `main`.
It needs **Settings → Pages → Source: GitHub Actions** enabled once on the
repository; until then the workflow builds and the deploy step fails.

`base` is `/time-aware-theme/` for builds only, so the dev server still answers
on `/`. Set `PLAYGROUND_BASE` to host it somewhere else.
