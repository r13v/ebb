// Builds the pi extension into one ES module, `dist/index.js`, with the shared core inside it.
// pi supplies its own packages to an extension, and Node its built-in modules, so both stay imports.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  // pi's own tsconfig, also for core/: the root one extends the engine's types, which only `mise run dev` writes.
  tsconfig: 'tsconfig.json',
  build: {
    lib: { entry: 'index.ts', formats: ['es'], fileName: 'index' },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: { external: [/^node:/, /^@earendil-works\//] },
  },
  // `.spec.ts`, not `.test.ts`: `claude plugin test` runs every `*.test.ts` of the checkout in its own environment.
  test: { include: ['**/*.spec.ts'], exclude: ['dist/**', 'node_modules/**'] },
})
