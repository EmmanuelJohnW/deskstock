import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Route handlers import 'server-only', which only resolves inside Next.js.
      'server-only': fileURLToPath(new URL('./vitest.server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/lib/forecast/**/*.ts', 'src/lib/offline/**/*.ts', 'src/lib/localHub/store.ts', 'src/lib/device/LiveRunTracker.ts'], exclude: ['**/*.test.ts'] },
  },
})
