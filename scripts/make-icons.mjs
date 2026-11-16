// Draws the app icons (blue square, yellow Nordic cross) as PNG files without
// any image library. Run with: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BLUE = [0x00, 0x5b, 0x99];
const YELLOW = [0xfe, 0xcb, 0x00];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

/** `inset` shrinks the cross toward the centre so a round mask never clips it. */
function icon(size, inset = 0) {
  const bar = Math.round(size * 0.16);
  const x0 = Math.round(size * (0.28 + inset * 0.3));
  const y0 = Math.round((size - bar) / 2);
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const yellow = (x >= x0 && x < x0 + bar) || (y >= y0 && y < y0 + bar);
      raw.set(yellow ? YELLOW : BLUE, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/', import.meta.url);
for (const [name, size, inset] of [
  ['pwa-192.png', 192, 0],
  ['pwa-512.png', 512, 0],
  ['maskable-512.png', 512, 0.25],
  ['apple-touch-icon.png', 180, 0],
]) {
  writeFileSync(new URL(name, out), icon(size, inset));
  console.log('wrote', name);
}
