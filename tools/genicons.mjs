// Generates the PWA icons (a vinyl record on the app's gradient) as PNGs — no
// image libraries, just a tiny hand-rolled RGBA PNG encoder. Run: node tools/genicons.mjs
import zlib from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(N * (1 + N * 4));
  for (let y = 0; y < N; y++) { raw[y * (1 + N * 4)] = 0; rgba.copy(raw, y * (1 + N * 4) + 1, y * N * 4, (y + 1) * N * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => a * (1 - t) + b * t;
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function render(N, disc = 0.42) {
  const buf = Buffer.alloc(N * N * 4);
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const ty = y / N;
    let r = lerp(0x18, 0x0b, ty), g = lerp(0x22, 0x0e, ty), b = lerp(0x41, 0x14, ty); // brand gradient
    const dx = x - c, dy = y - c, dist = Math.hypot(dx, dy) / N;
    if (dist <= disc + 0.012) {
      const inside = 1 - smooth(disc - 0.006, disc + 0.006, dist);
      const groove = 0.5 + 0.5 * Math.sin(dist * N * 0.85);
      let vr = 12 + groove * 12, vg = 12 + groove * 12, vb = 17 + groove * 16;
      const hl = Math.max(0, 1 - Math.hypot(x - N * 0.34, y - N * 0.34) / (N * 0.55));
      vr += hl * 42; vg += hl * 48; vb += hl * 66;
      const label = disc * 0.4;
      if (dist <= label) { const t = x / N; vr = lerp(0x6e, 0x9b, t); vg = lerp(0xa8, 0x6e, t); vb = 0xfe; }
      if (dist <= disc * 0.055) { vr = 9; vg = 11; vb = 17; } // spindle hole
      r = mix(r, vr, inside); g = mix(g, vg, inside); b = mix(b, vb, inside);
    }
    const i = (y * N + x) * 4;
    buf[i] = clamp(r); buf[i + 1] = clamp(g); buf[i + 2] = clamp(b); buf[i + 3] = 255;
  }
  return buf;
}

const files = [
  ['icon-192.png', 192, 0.42],
  ['icon-512.png', 512, 0.42],
  ['icon-maskable-512.png', 512, 0.34], // extra padding for maskable safe zone
  ['apple-touch-icon.png', 180, 0.42],
];
for (const [name, N, disc] of files) {
  writeFileSync(path.join(OUT, name), encodePng(N, render(N, disc)));
  console.log('wrote', name, `${N}x${N}`);
}
