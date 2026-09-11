const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const sample = path.resolve(__dirname, '../sample-label.png');
const { createAppServer } = require('../scripts/serve.cjs');

test('camera, editing, UTF-8 export and invalid photo recovery', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '사진 찍기' }).click();
  await (await chooser).setFiles(sample);
  await expect(page.locator('#result')).toHaveValue('HP딘버일자/그레이');
  await expect(page.locator('#result')).toBeEditable();
  await page.locator('#result').fill('수정한 제품명/파랑\n상품 123');
  await expect(page.locator('#count')).toHaveText('14자');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 저장' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^label-ocr-.*\.txt$/);
  const saved = await fs.readFile(await download.path(), 'utf8');
  expect(saved).toBe('\uFEFF수정한 제품명/파랑\n상품 123');
  await page.locator('#result').fill('');
  await expect(page.locator('#copy')).toBeDisabled();
  await expect(page.locator('#save')).toBeDisabled();
  await page.locator('#gallery').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('invalid photo') });
  await expect(page.locator('#status')).toContainText('사진을 열 수 없습니다');
  await expect(page.locator('#galleryButton')).toBeEnabled();
  await page.locator('#gallery').setInputFiles(sample);
  await expect(page.locator('#result')).toHaveValue('HP딘버일자/그레이');
  await expect(page.locator('#result')).toBeEditable();
  await page.locator('.install summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('offline cold page load keeps OCR usable and preserves other apps caches', async ({ page }) => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
  await page.goto(origin + '/manifest.json');
  await page.evaluate(async () => {
    const cache = await caches.open('another-app-cache');
    await cache.put('/other-app-marker', new Response('keep me'));
  });
  await page.goto(origin);
  await expect(page.locator('#status')).toContainText('준비됐습니다');
  // Cache models and core are now available; no original photo is needed in the cache.
  // Stop the actual server: WebKit on Windows fails navigation in Playwright's simulated offline mode.
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await page.reload();
  await expect(page.locator('#status')).toContainText('준비됐습니다');
  await page.locator('#gallery').setInputFiles(sample);
  await expect(page.locator('#result')).toHaveValue('HP딘버일자/그레이');
  // Check the name without opening it: caches.open would recreate a wrongly deleted cache.
  // Synthetic Response bodies can be discarded on navigation in Windows WebKit.
  expect(await page.evaluate(() => caches.keys())).toContain('another-app-cache');
  expect(await page.evaluate(async () => {
    try { await fetch('/missing-script.js'); return 'unexpected success'; } catch { return 'network failure'; }
  })).toBe('network failure');
  } finally { server.closeAllConnections(); server.close(); }
});

test('crop can be cancelled and cleared without leaving a stuck selection', async ({ page }) => {
  await page.goto('/');
  await page.locator('#gallery').setInputFiles(sample);
  await expect(page.locator('#result')).toHaveValue('HP딘버일자/그레이');
  await expect(page.locator('#rerun')).toBeEnabled();
  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  const event = { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: box.x + 20, clientY: box.y + 20 };
  // Real pointer capture requires a live pointer; use a mouse pointer for the drag then cancel it.
  await page.mouse.move(event.clientX, event.clientY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 20);
  await expect(page.locator('#sel')).toBeVisible();
  await stage.dispatchEvent('pointercancel', event);
  await page.mouse.up();
  await expect(page.locator('#sel')).toBeHidden();
  await expect(page.locator('#rerun')).toBeEnabled();
  await page.evaluate(() => {
    const source = window.hangulOcr.source;
    window.hangulOcr.setCrop({ x: 0.35, y: 0.7, w: source.width - 2.1, h: source.height - 2.2 });
  });
  await page.locator('#rerun').click();
  await expect(page.locator('#rerun')).toBeEnabled();
  await expect(page.locator('#result')).toHaveValue('HP딘버일자/그레이');
  await page.locator('#cropClear').click();
  await expect(page.locator('#rerun')).toBeEnabled();
  await expect(page.locator('#sel')).toBeHidden();
});

test('large photo downscales through the image fallback and remains readable', async ({ page }) => {
  await page.addInitScript(() => { window.createImageBitmap = undefined; });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const img = new Image(); img.src = '/sample-label.png'; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = 3600; canvas.height = 4000;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await window.hangulOcr.handleFile(new File([blob], 'large.png', { type: 'image/png' }));
    return { longestSide: Math.max(hangulOcr.source.width, hangulOcr.source.height), text: document.querySelector('#result').value };
  });
  expect(result).toEqual({ longestSide: 2400, text: 'HP딘버일자/그레이' });
});
