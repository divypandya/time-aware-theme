import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/dom.ts', 'src/react.tsx', 'src/testing.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  external: ['react', 'react-dom']
});
