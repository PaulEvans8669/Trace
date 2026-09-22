import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      // The v8 provider uses Node's built-in coverage, so there is no extra
      // instrumentation cost compared to the istanbul provider.
      provider: 'v8',
      // Coverage only runs when explicitly requested (`vitest run --coverage`),
      // keeping the plain `npm run test` loop fast.
      enabled: false,
      // `text` prints a table in the CI log; `json-summary` is machine readable
      // and is what the Quality workflow renders into the GitHub job summary.
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      // `all: true` also counts source files that have no tests at all, so the
      // percentage reflects the whole codebase rather than only tested files.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Tests themselves are not production code.
        'src/**/*.test.{ts,tsx}',
        // Type-only modules compile away to nothing meaningful at runtime.
        // (Note: `src/**/types/format.ts` holds real logic and stays included.)
        'src/**/types/index.ts',
        'src/backend/types/**',
        // Static assets imported by the UI.
        'src/frontend/assets/**',
        // Forge entry shims: a few lines of ForgeReconciler glue with no logic.
        'src/frontend/byline-item.tsx',
        'src/frontend/issue-context.tsx'
      ]
      // Coverage is intentionally NON-BLOCKING: no thresholds are configured, so
      // a low percentage can never fail the Quality gate. To start enforcing a
      // minimum later, add e.g.:
      //   thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 }
    }
  }
});
