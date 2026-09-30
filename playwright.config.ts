import { defineConfig, devices } from '@playwright/test'

const isProductionCSP = process.env.E2E_PRODUCTION === 'true'

export default defineConfig({
  testDir: './e2e',
  // The on-chain journey needs a local network; see playwright.chain.config.ts.
  testIgnore: ['chain/**'],
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: isProductionCSP ? 'http://localhost:3001' : 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isProductionCSP
    ? {
        command: 'bun run build && PORT=3001 CSP_MODE=enforce bun run start',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : {
        command: 'bun run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
