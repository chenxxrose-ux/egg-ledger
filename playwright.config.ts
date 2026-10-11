import { defineConfig } from '@playwright/test'

// 驗收測試：iPhone 尺寸（393×852）＋本機 Supabase 替身（真的 Postgres 與專案 migration）
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'iphone-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: [
    { command: 'node e2e/mock-supabase.mjs', port: 54321, reuseExistingServer: false },
    {
      command: 'npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
