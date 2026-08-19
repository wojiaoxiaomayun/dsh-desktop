// Print dimensions and top colors of a PNG (for verifying generated icons).
// Usage: node scripts/analyze-png.js <file.png>
const fs = require('fs');
const zlib = require('zlib');

const src = process.argv[2];
const buf = fs.readFileSync(src);
let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off); off += 4;
  const type = buf.toString('ascii', off, off + 4); off += 4;
  const data = buf.subarray(off, off + len); off += len; off += 4;
  if (type === 'IHDR') {
    width = data.readUInt32BE(0); height = data.readUInt32BE(4);
    bitDepth = data[8]; colorType = data[9]; interlace = data[12];
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
}
const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
const raw = zlib.inflateSync(Buffer.concat(idat));
const bpp = channels, stride = width * bpp;
const px = Buffer.alloc(height * stride);
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); if (pa <= pb && pa <= pc) return a; if (pb <= pc) return b; return c; }
let pos = 0;
for (let y = 0; y < height; y++) {
  const f = raw[pos++], rs = y * stride;
  for (let x = 0; x < stride; x++) {
    const cur = raw[pos++];
    const left = x >= bpp ? px[rs + x - bpp] : 0;
    const up = y > 0 ? px[rs - stride + x] : 0;
    const ul = (y > 0 && x >= bpp) ? px[rs - stride + x - bpp] : 0;
    let v = cur;
    if (f === 1) v += left; else if (f === 2) v += up; else if (f === 3) v += Math.floor((left + up) / 2); else if (f === 4) v += paeth(left, up, ul);
    px[rs + x] = v & 0xff;
  }
}
const counts = new Map();
for (let i = 0; i < px.length; i += 3) {
  const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
  counts.set(k, (counts.get(k) || 0) + 1);
}
const total = width * height;
console.log(`${src}  ${width}x${height}  distinct=${counts.size}`);
const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
for (const [k, n] of top) {
  console.log('  #' + k.toString(16).padStart(6, '0') + '  ' + (100 * n / total).toFixed(1) + '%');
}
