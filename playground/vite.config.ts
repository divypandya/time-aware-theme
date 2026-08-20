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
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true }
}));
