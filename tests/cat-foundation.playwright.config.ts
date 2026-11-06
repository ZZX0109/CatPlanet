import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: ['cat-model-contract.browser.spec.ts', 'room-draft.spec.ts'],
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: { command: 'npm run dev -- --hostname 127.0.0.1 --port 3000', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 120_000 },
});
