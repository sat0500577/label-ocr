const { test, expect } = require('@playwright/test');

test('product column wins when the right category starts slightly higher', async ({ page }) => {
  await page.goto('/');
  const actual = await page.evaluate(() => {
    const line = (text, x0, y0, conf = 95) => ({
      x0, y0, y1: y0 + 40, h: 40,
      words: [{ text, x0, x1: x0 + 120, conf }],
    });
    const review = {};
    const text = hangulOcr.labelFormat({
      kor: { lines: [line('걸즈+하우스', 352, 33), line('브리비4', 108, 36),
        line('그레이', 87, 87), line('비즈팔찌', 416, 101)] },
      eng: { symbols: [{ text: 'B', x0: 72, x1: 103, cy: 55, conf: 95 }] },
    }, review);
    return { text, review };
  });
  expect(actual).toEqual({ text: 'B브리비/그레이', review: { uncertain: false } });
});

test('uncertain product characters are flagged without replacing them with a guessed name', async ({ page }) => {
  await page.goto('/');
  const actual = await page.evaluate(() => {
    const review = {};
    const kor = { lines: [
      { x0: 68, y0: 18, y1: 55, h: 37, words: [
        { text: '뭘', conf: 43, x0: 98, x1: 123 },
        { text: '리', conf: 93, x0: 131, x1: 151 },
        { text: '비', conf: 88, x0: 169, x1: 182 },
        { text: '6', conf: 97, x0: 195, x1: 207 },
      ] },
      { x0: 80, y0: 60, y1: 89, h: 29, words: [{ text: '민트', conf: 95, x0: 80, x1: 136 }] },
    ] };
    const eng = { symbols: [{ text: 'B', conf: 95, x0: 68, x1: 93, cy: 35 }] };
    const text = hangulOcr.labelFormat({ kor, eng }, review);
    return { text, review };
  });
  expect(actual).toEqual({ text: 'B뭘리비/민트', review: { uncertain: true } });
});
