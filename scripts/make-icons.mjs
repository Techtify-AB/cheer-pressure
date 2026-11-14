// Draws the placeholder app icons as PNG files, locally, with no dependencies.
// Run: node scripts/make-icons.mjs   (writes public/icons/icon-192.png, icon-512.png and src-tauri/icons/tray.png)
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [246, 242, 234];
const BODY = [242, 195, 155];
const INK = [51, 48, 44];
const LEAF = [47, 102, 86];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function draw(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const s = size / 100; // design on a 100 x 100 grid
  const cover = (d) => Math.max(0, Math.min(1, 0.5 - d / s)); // anti-aliased edge from signed distance
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / s, py = (y + 0.5) / s;
      let c = BG;
      // body
      const dBody = Math.hypot((px - 50) / 1.0, (py - 54) / 0.94) - 33;
      c = mix(c, BODY, cover(dBody * s));
      // leaf
      const dLeaf = Math.hypot((px - 58) / 1.6, py - 19) - 4.2;
      c = mix(c, LEAF, cover(dLeaf * s));
      // eyes
      for (const ex of [39, 61]) {
        const dEye = Math.hypot((px - ex) * 1.35, py - 50) - 4.6;
        c = mix(c, INK, cover(dEye * s));
      }
      // smile: arc of a circle, lower half only
      const r = Math.hypot(px - 50, py - 58);
      if (py > 61) c = mix(c, INK, cover((Math.abs(r - 8) - 1.6) * s));
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Menu bar (tray) icon for the desktop app: a black silhouette on transparent, with
// the face cut out. macOS treats it as a template image and tints it for light and
// dark menu bars.
function drawTray(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const s = size / 100;
  const cover = (d) => Math.max(0, Math.min(1, 0.5 - d / s));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / s, py = (y + 0.5) / s;
      let a = cover((Math.hypot(px - 50, (py - 56) / 0.94) - 40) * s);
      a = Math.max(a, cover((Math.hypot((px - 60) / 1.6, py - 12) - 6) * s));
      for (const ex of [36, 64]) a *= 1 - cover((Math.hypot((px - ex) * 1.35, py - 50) - 6.5) * s);
      const r = Math.hypot(px - 50, py - 60);
      if (py > 63) a *= 1 - cover((Math.abs(r - 11) - 2.6) * s);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, draw(size));
console.log("Wrote public/icons/icon-192.png and icon-512.png");
mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/tray.png", drawTray(44));
console.log("Wrote src-tauri/icons/tray.png");
