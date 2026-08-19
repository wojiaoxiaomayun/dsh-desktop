// Converts a source image (any squared PNG, e.g. a small 60x60 logo) into:
//   1. app-icon.png  — 1024x1024 RGBA, upscaled with bilinear sampling (input for `tauri icon`)
//   2. dist/logo.png — 256x256 RGBA, used by the loading page brand logo
// Usage: node scripts/convert-icon.js <source.png>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/convert-icon.js <source.png>');
  process.exit(1);
}

// ---- PNG decode (8-bit, non-interlaced, color types 0/2/4/6) ----
const buf = fs.readFileSync(src);
let off = 8; // skip signature
let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off); off += 4;
  const type = buf.toString('ascii', off, off + 4); off += 4;
  const data = buf.subarray(off, off + len); off += len;
  off += 4; // crc
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    interlace = data[12];
  } else if (type === 'IDAT') {
    idat.push(data);
  } else if (type === 'IEND') {
    break;
  }
}
if (bitDepth !== 8) throw new Error('only 8-bit PNG supported, got bitDepth=' + bitDepth);
if (interlace !== 0) throw new Error('interlaced PNG not supported');
const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
if (!channels) throw new Error('unsupported color type ' + colorType);

const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = channels;
const stride = width * bpp;
const pixels = Buffer.alloc(height * stride);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

let pos = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[pos++];
  const rowStart = y * stride;
  for (let x = 0; x < stride; x++) {
    const cur = raw[pos++];
    const left = x >= bpp ? pixels[rowStart + x - bpp] : 0;
    const up = y > 0 ? pixels[rowStart - stride + x] : 0;
    const upLeft = (y > 0 && x >= bpp) ? pixels[rowStart - stride + x - bpp] : 0;
    let v = cur;
    if (filter === 1) v += left;
    else if (filter === 2) v += up;
    else if (filter === 3) v += Math.floor((left + up) / 2);
    else if (filter === 4) v += paeth(left, up, upLeft);
    pixels[rowStart + x] = v & 0xff;
  }
}

// ---- analysis (informational) ----
const counts = new Map();
for (let i = 0; i < pixels.length; i += 3) {
  const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
  counts.set(key, (counts.get(key) || 0) + 1);
}
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('source:', src, `(${width}x${height}, colorType=${colorType})`);
console.log('distinct colors:', counts.size);
console.log('top colors (hex:count):');
for (const [k, n] of top) {
  console.log('  #' + k.toString(16).padStart(6, '0') + ' : ' + n);
}
const corner = (x, y) => {
  const i = (y * width + x) * 3;
  return '#' + [pixels[i], pixels[i + 1], pixels[i + 2]].map(b => b.toString(16).padStart(2, '0')).join('');
};
console.log('corners:', corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1));

// ---- bilinear sample from decoded RGB(A) ----
function sampleRGB(u, v) {
  const x = Math.min(Math.max(u, 0), width - 1.0001);
  const y = Math.min(Math.max(v, 0), height - 1.0001);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0, fy = y - y0;
  const get = (px, py, c) => pixels[(py * width + px) * channels + c];
  const out = [];
  for (let c = 0; c < 3; c++) {
    const a = get(x0, y0, c), b = get(x1, y0, c), d = get(x0, y1, c), e = get(x1, y1, c);
    out.push(Math.round(a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy));
  }
  return out;
}

function resize(outW, outH, alpha) {
  const out = Buffer.alloc(outW * outH * 4);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const u = ((ox + 0.5) * width / outW) - 0.5;
      const v = ((oy + 0.5) * height / outH) - 0.5;
      const [r, g, b] = sampleRGB(u, v);
      const oi = (oy * outW + ox) * 4;
      out[oi] = r; out[oi + 1] = g; out[oi + 2] = b; out[oi + 3] = alpha;
    }
  }
  return out;
}

// ---- PNG encode (RGBA) ----
function crc32(b) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < b.length; i++) crc = (crc >>> 8) ^ table[(crc ^ b[i]) & 0xff];
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
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// preserve alpha if the source had it; otherwise opaque
const hasAlpha = channels === 4;
const outIcon = resize(1024, 1024, 255);
const outLogo = resize(256, 256, 255);

const root = path.join(__dirname, '..');
const iconPath = path.join(root, 'app-icon.png');
const logoPath = path.join(root, 'dist', 'logo.png');
fs.writeFileSync(iconPath, encodePNG(1024, 1024, outIcon));
fs.mkdirSync(path.dirname(logoPath), { recursive: true });
fs.writeFileSync(logoPath, encodePNG(256, 256, outLogo));
console.log('Wrote', iconPath, '(', outIcon.length, 'bytes of pixels )');
console.log('Wrote', logoPath);
