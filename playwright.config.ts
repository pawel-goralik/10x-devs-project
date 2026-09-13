import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";
import { E2E_STORAGE_STATE } from "./tests/e2e/support/storage-state-path";

// Same env-loading approach as vitest.config.ts, so SUPABASE_URL / SUPABASE_KEY /
// SUPABASE_SERVICE_ROLE_KEY from .env reach the test process without a separate
// dotenv-cli step.
Object.assign(process.env, loadEnv("", process.cwd(), ""));

const PORT = 4321;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: E2E_STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
