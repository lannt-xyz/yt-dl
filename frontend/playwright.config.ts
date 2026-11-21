import { defineConfig } from "@playwright/test";

// Máy local dùng Chrome cài sẵn:  PW_CHANNEL=chrome E2E_PYTHON=../venv/bin/python npx playwright test
// CI dùng Chromium của Playwright (npx playwright install chromium).
const channel = process.env.PW_CHANNEL || undefined;
const python = process.env.E2E_PYTHON ?? "python3";
const PORT = 8801;
const AUTH_PORT = 8802;

const serverEnv = (data: string, extra = "") =>
  `rm -rf ${data} && mkdir -p ${data} && YT_FAKE_DOWNLOADER=1 YT_DATA_DIR=${data} YT_STATIC_DIR=dist ` +
  `YT_UPDATE_CHECK_HOURS=0 YT_RETENTION_DAYS=0 YT_CLEANUP_INTERVAL_MIN=0 ${extra}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  // Các test dùng chung một server + DB nên chạy tuần tự; mỗi test tự reset trạng thái.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "vi-VN",
  },
  projects: [
    {
      name: "iphone",
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
      testIgnore: /auth\.spec|pwa\.spec/,
    },
    {
      name: "ipad",
      use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      testIgnore: /auth\.spec|pwa\.spec/,
    },
    {
      name: "ipad-landscape",
      use: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      testMatch: /responsive\.spec/,
    },
    {
      name: "desktop",
      use: { viewport: { width: 1366, height: 800 } },
    },
  ],
  webServer: [
    {
      command: `sh -c "${serverEnv("e2e/.data")} ${python} -m uvicorn app.main:create_app --factory --app-dir ../backend --port ${PORT}"`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `sh -c "${serverEnv("e2e/.data-auth", "YT_PASSWORD=e2e-password-123")} ${python} -m uvicorn app.main:create_app --factory --app-dir ../backend --port ${AUTH_PORT}"`,
      url: `http://localhost:${AUTH_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
