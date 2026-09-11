// Canvas의 'high' 필터는 브라우저마다 다르다. Mitchell bicubic 필터를
// 가로·세로로 적용해 같은 사진을 같은 방식으로 확대/축소한다.
// 32행씩 읽고 필요한 중간 행만 보관해 큰 사진의 픽셀 전체를 복제하지 않는다.
function resizeForOcr(source, sx, sy, sw, sh, width, height, keepColor = false) {
  sx = Math.max(0, Math.round(sx)); sy = Math.max(0, Math.round(sy));
  sw = Math.min(source.width - sx, Math.max(1, Math.round(sw)));
  sh = Math.min(source.height - sy, Math.max(1, Math.round(sh)));
  const b = 1 / 3, c = 1 / 3;
  function kernel(value) {
    const x = Math.abs(value);
    if (x < 1) return ((12 - 9*b - 6*c)*x*x*x + (-18 + 12*b + 6*c)*x*x + 6 - 2*b) / 6;
    if (x < 2) return ((-b - 6*c)*x*x*x + (6*b + 30*c)*x*x + (-12*b - 48*c)*x + 8*b + 24*c) / 6;
    return 0;
  }
  function weights(from, to) {
    const scale = from / to, filter = Math.max(1, scale);
    return Array.from({ length: to }, (_, out) => {
      const center = (out + 0.5) * scale - 0.5;
      const values = [];
      let sum = 0;
      for (let i = Math.ceil(center - 2 * filter); i <= Math.floor(center + 2 * filter); i++) {
        const weight = kernel((center - i) / filter);
        values.push([Math.max(0, Math.min(from - 1, i)), weight]);
        sum += weight;
      }
      return values.map(([i, weight]) => [i, weight / sum]);
    });
  }
  const wx = weights(sw, width), wy = weights(sh, height);
  const channels = keepColor ? 3 : 1;
  const reader = document.createElement('canvas');
  reader.width = sw; reader.height = Math.min(32, sh);
  const input = reader.getContext('2d', { willReadFrequently: true });
  const rows = new Map();
  let bandStart = -1, bandHeight = 0, pixels;

  function horizontalRow(row) {
    if (rows.has(row)) return rows.get(row);
    if (row < bandStart || row >= bandStart + bandHeight) {
      bandStart = row; bandHeight = Math.min(32, sh - row);
      input.clearRect(0, 0, sw, reader.height);
      input.drawImage(source, sx, sy + row, sw, bandHeight, 0, 0, sw, bandHeight);
      pixels = input.getImageData(0, 0, sw, bandHeight).data;
    }
    const values = new Float32Array(sw * channels);
    for (let x = 0; x < sw; x++) {
      const n = ((row - bandStart) * sw + x) * 4, alpha = pixels[n + 3] / 255;
      if (keepColor) {
        for (let k = 0; k < 3; k++) values[x * 3 + k] = pixels[n + k] * alpha + 255 * (1 - alpha);
      } else {
        values[x] = (pixels[n] * 0.299 + pixels[n + 1] * 0.587 + pixels[n + 2] * 0.114) * alpha + 255 * (1 - alpha);
      }
    }
    const output = new Float32Array(width * channels);
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < channels; k++) {
        let value = 0;
        for (const [i, weight] of wx[x]) value += values[i * channels + k] * weight;
        output[x * channels + k] = value;
      }
    }
    rows.set(row, output);
    return output;
  }

  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const data = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const samples = wy[y].map(([row, weight]) => [horizontalRow(row), weight]);
    for (let x = 0; x < width; x++) {
      const n = (y * width + x) * 4;
      for (let k = 0; k < channels; k++) {
        let value = 0;
        for (const [row, weight] of samples) value += row[x * channels + k] * weight;
        data.data[n + k] = Math.round(value);
      }
      if (!keepColor) data.data[n + 1] = data.data[n + 2] = data.data[n];
      data.data[n + 3] = 255;
    }
    const first = wy[y][0][0];
    for (const row of rows.keys()) if (row < first) rows.delete(row);
  }
  ctx.putImageData(data, 0, 0);
  reader.width = reader.height = 0;
  return out;
}
