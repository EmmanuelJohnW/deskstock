import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: { include: ['src/lib/forecast/**/*.ts', 'src/lib/offline/**/*.ts'], exclude: ['**/*.test.ts'] },
  },
})
