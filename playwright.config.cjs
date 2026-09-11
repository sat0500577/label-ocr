const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  globalSetup: './tests/prepare-images.cjs',
  timeout: 120000,
  expect: { timeout: 60000 },
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'android-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'node scripts/serve.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
