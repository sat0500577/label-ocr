const { test, expect } = require('@playwright/test');
const path = require('node:path');
test.use({ serviceWorkers: 'block' });

async function mockEngine(page) {
  await page.route('**/vendor/tesseract.min.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.createdWorkers = 0;
      window.Tesseract = { createWorker: async () => {
        window.createdWorkers++;
        if (window.createdWorkers === 1) await new Promise((resolve, reject) => {
          window.readyEngine = resolve; window.failEngine = () => reject(new Error('download failed'));
        });
        return { reinitialize: async () => {}, setParameters: async () => {},
          recognize: async () => ({ data: { text: '라벨 테스트', blocks: [] } }), terminate: async () => {} };
      }};`,
  }));
  await page.addInitScript(() => localStorage.setItem('mode', 'all'));
  await page.goto('/');
  await page.waitForFunction(() => window.createdWorkers === 1);
}

test('photo during engine startup shares one worker and locks photo selection', async ({ page }) => {
  await mockEngine(page);
  await page.locator('#gallery').setInputFiles(path.resolve(__dirname, '../sample-label.png'));
  await expect(page.locator('#cameraButton')).toBeDisabled();
  await expect(page.locator('#galleryButton')).toBeDisabled();
  await expect(page.locator('#rerun')).toBeDisabled();
  expect(await page.evaluate(() => window.createdWorkers)).toBe(1);
  await page.evaluate(() => window.readyEngine());
  await expect(page.locator('#result')).toHaveValue('라벨 테스트');
  await expect(page.locator('#galleryButton')).toBeEnabled();
  expect(await page.evaluate(() => window.createdWorkers)).toBe(1);
});

test('failed initialization releases controls and can be retried', async ({ page }) => {
  await mockEngine(page);
  await page.locator('#gallery').setInputFiles(path.resolve(__dirname, '../sample-label.png'));
  await expect(page.locator('#cameraButton')).toBeDisabled();
  await page.evaluate(() => window.failEngine());
  await expect(page.locator('#status')).toContainText('인식하지 못했습니다');
  await expect(page.locator('#rerun')).toBeEnabled();
  await page.locator('#rerun').click();
  await expect(page.locator('#result')).toHaveValue('라벨 테스트');
  expect(await page.evaluate(() => window.createdWorkers)).toBe(2);
});
