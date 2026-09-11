const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const renderVariant = require('./render-variant.cjs');

module.exports = async function prepareImages() {
  // Produce each test photograph once, so both engines receive identical PNG bytes.
  // Rendering a distant/blurred variant in each browser would change the input itself.
  const root = path.resolve(__dirname, '..');
  await fs.mkdir(path.join(root, 'test-fixtures'), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const sample of ['sample-label.png', 'sample-label2.png']) {
      const base64 = (await fs.readFile(path.join(root, sample))).toString('base64');
      for (const variant of ['blur', 'dark', 'tilt', 'distant', 'wide', 'borders', '90', '180', '270']) {
        const png = await page.evaluate(renderVariant, { base64, variant });
        await fs.writeFile(path.join(root, 'test-fixtures', `${sample}-${variant}.png`), Buffer.from(png, 'base64'));
      }
    }
  } finally { await browser.close(); }
};
