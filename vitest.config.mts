import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['**/*.test.{ts,tsx}'],
    // Vitest's 5s default is tight on a loaded CI runner: the Soroban vault
    // and AddressChip suites intermittently timed out there while passing
    // reliably in isolation (#596). Generous enough for a slow machine,
    // short enough to still catch a real hang.
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/lib/**/*.{ts,tsx}', 'src/wallet/**/*.{ts,tsx}'],
      exclude: ['node_modules/', 'dist/', '.next/', '**/*.test.{ts,tsx}'],
      // Enforced in CI (#608, #662). The API client and the vault's Soroban builders
      // must stay at 80%; the directory floors only stop regressions — raise
      // them as admin.ts / registry.ts / useVault.ts gain tests.
      // The following modules have ≥80% coverage from #662:
      thresholds: {
        'src/lib/api.ts': { lines: 80, statements: 80, functions: 80 },
        'src/wallet/vault.ts': { lines: 80, statements: 80, functions: 80 },
        'src/lib/webauthn.ts': { lines: 80, statements: 80, functions: 80 },
        'src/lib/yieldAlerts.ts': { lines: 80, statements: 80, functions: 80 },
        'src/lib/recurringInvestments.ts': { lines: 80, statements: 80, functions: 80 },
        'src/lib/scrollToError.ts': { lines: 80, statements: 80, functions: 80 },
        'src/lib/**': { lines: 55 },
        'src/wallet/**': { lines: 55 },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
