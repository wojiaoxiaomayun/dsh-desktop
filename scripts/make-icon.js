// Generates a simple 1024x1024 app icon (PNG) for `tauri icon`.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const px = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  const i = (y * SIZE + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

// Background: subtle navy vertical gradient
for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE;
  const r = Math.round(0x16 + (0x24 - 0x16) * t);
  const g = Math.round(0x18 + (0x28 - 0x18) * t);
  const b = Math.round(0x2c + (0x40 - 0x2c) * t);
  for (let x = 0; x < SIZE; x++) setPixel(x, y, r, g, b);
}

function insideRoundedRect(x, y, cx, cy, w, h, radius) {
  const dx = Math.abs(x - cx) - (w / 2 - radius);
  const dy = Math.abs(y - cy) - (h / 2 - radius);
  if (dx > 0 && dy > 0) return dx * dx + dy * dy <= radius * radius;
  return dx <= 0 || dy <= 0;
}

const cx = SIZE / 2;
const cy = SIZE / 2;
// Accent-blue rounded "window" shape
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (insideRoundedRect(x, y, cx, cy, 640, 470, 130)) setPixel(x, y, 0x4f, 0x9d, 0xff);
  }
}
// Three white "traffic light" dots
for (const dx of [-190, 0, 190]) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ddx = x - (cx + dx);
      const ddy = y - cy;
      if (ddx * ddx + ddy * ddy <= 42 * 42) setPixel(x, y, 0xff, 0xff, 0xff);
    }
  }
}

function crc32(buf) {
  if (!crc32.table) {
    const table = (crc32.table = new Int32Array(256));
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crc32.table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter type 0 (None)
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'app-icon.png');
if (fs.existsSync(out)) {
  console.log('app-icon.png 已存在，跳过生成（保留自定义图标）');
} else {
  fs.writeFileSync(out, png);
  console.log('Wrote', out, '(', png.length, 'bytes )');
}
