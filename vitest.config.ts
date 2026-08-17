import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Lets the certification suite import examples/react's theme system,
      // which imports the package by name the way a real installer would.
      '@divypandya/time-aware-theme': fileURLToPath(
        new URL('./src/index.ts', import.meta.url)
      )
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      // Only measure shipped source. Example apps and build scripts previously
      // dragged the aggregate to ~50% and obscured the real figures.
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // Thresholds block rather than inform, so coverage cannot quietly decay.
      // Set as a ratchet just below what the suite currently achieves; raise
      // them as coverage improves rather than lowering them to fit a change.
      // Target for src/core.ts remains 95% branches — the remaining gap is
      // defensive throws that need malformed frozen state to reach.
      thresholds: {
        'src/core.ts': { statements: 93, branches: 87, functions: 97 },
        'src/dom.ts': { statements: 90, branches: 88, functions: 78 },
        'src/contrast.ts': { statements: 100, branches: 100, functions: 100 },
        'src/testing.ts': { statements: 93, branches: 94, functions: 80 },
        'src/inspect.ts': { statements: 94, branches: 75, functions: 100 },
        'src/tailwind.ts': { statements: 94, branches: 85, functions: 100 },
        'src/react.tsx': { statements: 88, branches: 83, functions: 100 },
        'src/react-ui.tsx': { statements: 100, branches: 93, functions: 100 },
        // Presets are data, so line coverage is trivially total. The gate that
        // matters for them is scripts/certify.mjs.
        'src/presets/**': { statements: 100, branches: 100, functions: 100 }
      }
    }
  }
});
