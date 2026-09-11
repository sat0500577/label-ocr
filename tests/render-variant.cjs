module.exports = async function renderVariant({base64, variant}) {
    const blob = await fetch('data:image/png;base64,' + base64).then(r => r.blob());
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width, h = bitmap.height;
    const c = document.createElement('canvas');
    const turn = Number(variant) || 0;
    const padding = ['distant', 'wide', 'borders'].includes(variant);
    c.width = turn % 180 ? h : padding ? w * 2 : w;
    c.height = turn % 180 ? w : padding ? h * 2 : h;
    const x = c.getContext('2d');
    // Camera photographs are opaque. Blur must not introduce transparent edges,
    // whose premultiplied-alpha decoding varies across browser engines.
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    if (padding) {
      // Textured background derived from the source; black letterbox is intentional.
      x.filter = 'blur(30px)';
      x.drawImage(bitmap, 0, 0, c.width, c.height); x.filter = 'none';
      const pixels = x.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const noise = ((i * 13 % 19) - 9) * 0.3;
        for (let k = 0; k < 3; k++) pixels.data[i + k] += noise;
      }
      x.putImageData(pixels, 0, 0);
      const scale = variant === 'distant' ? 0.6 : 1;
      x.drawImage(bitmap, (c.width - w * scale) / 2, (c.height - h * scale) / 2, w * scale, h * scale);
      if (variant === 'borders') {
        x.fillStyle = '#000'; x.fillRect(0, 0, c.width, h / 2); x.fillRect(0, c.height - h / 2, c.width, h / 2);
      }
    } else {
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      if (variant === 'blur') x.filter = 'blur(0.6px)';
      if (variant === 'dark') x.filter = 'brightness(0.55)';
      x.translate(c.width / 2, c.height / 2);
      x.rotate((variant === 'tilt' ? 6 : turn) * Math.PI / 180);
      x.drawImage(bitmap, -w / 2, -h / 2);
    }

bitmap.close();return c.toDataURL('image/png').split(',')[1];
};
