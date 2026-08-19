import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/dom.ts',
    'src/react.tsx',
    'src/react-ui.tsx',
    'src/testing.ts',
    'src/inspect.ts',
    'src/solve.ts',
    'src/tailwind.ts',
    'src/presets/dawn-to-dusk.ts',
    'src/presets/tidal.ts',
    'src/presets/contrast-first.ts',
    'src/presets/paper.ts'
  ],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  // The four presets each embed a whole theme system and all of them pull in
  // core. Splitting hoists that into one shared chunk instead of inlining the
  // resolver four times.
  splitting: true,
  treeshake: true,
  outDir: 'dist',
  external: ['react', 'react-dom']
});
