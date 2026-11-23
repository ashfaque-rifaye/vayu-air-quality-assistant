import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: PW_CHANNEL=chrome runs against an installed Chrome instead of
        // Playwright's bundled Chromium. CI leaves it unset.
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: {
    command: "npm run build && node dist/server/index.mjs",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // No keys: the journey runs on the offline planner unless a test stubs the AI,
    // so end-to-end runs are deterministic and never spend quota.
    env: { PORT: String(PORT), NO_DOTENV: "1", GEMINI_API_KEY: "", FIREWORKS_API_KEY: "" },
  },
});
