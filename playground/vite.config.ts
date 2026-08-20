import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // Only the built site lives under a path prefix - GitHub Pages serves it
  // from https://divypandya.github.io/time-aware-theme/. Applying that in dev
  // too just makes the local server answer on a subpath for no reason.
  // PLAYGROUND_BASE covers anyone hosting the build somewhere else.
  base:
    command === 'build'
      ? (process.env.PLAYGROUND_BASE ?? '/time-aware-theme/')
      : '/',
  // The package is linked with file:, so its symlinked directory resolves
  // 'react' from the repo root while the app resolves its own copy. Two React
  // instances means hooks run against a dispatcher that is not the renderer's,
  // and the page dies with "Cannot read properties of null (reading
  // 'useState')" - in the production build only, which is how it reached a
  // deployed site before being noticed.
  resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true }
}));
