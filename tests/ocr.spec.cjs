const { test, expect } = require('@playwright/test');

async function readSample(page, sample, variant = 'original') {
  const file = variant === 'original' ? sample : `test-fixtures/${sample}-${variant}.png`;
  return page.evaluate(async file => {
    const blob = await fetch('/' + file).then(r => r.blob());
    await window.hangulOcr.handleFile(new File([blob], file, {type: 'image/png'}));
    return document.getElementById('result').value;
  }, file);
}

test('two reference labels', async ({ page }) => {
  await page.goto('/');
  for (const [file, expected] of [['sample-label.png', 'HP딘버일자/그레이'], ['sample-label2.png', 'R유광하이/그린']]) {
    expect(await readSample(page, file)).toBe(expected);
  }
});

// The repository's OCR skill requires all these transformations after OCR changes.
test('reference labels under rotation, lighting and framing changes', async ({ page }) => {
  test.setTimeout(600000);
  await page.goto('/');
  for (const [file, expected] of [['sample-label.png', 'HP딘버일자/그레이'], ['sample-label2.png', 'R유광하이/그린']]) {
    for (const variant of ['blur', 'dark', 'tilt', 'distant', 'wide', 'borders', '90', '180', '270']) {
      const actual = await readSample(page, file, variant);
      console.log(file, variant, actual);
      expect.soft(actual, `${file}: ${variant}`).toBe(expected);
    }
  }
});
