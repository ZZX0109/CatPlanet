import { defineConfig } from "@playwright/test";
process.loadEnvFile(".env.local");
process.env.NO_PROXY = "localhost,127.0.0.1,::1";
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1365, height: 900 },
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
