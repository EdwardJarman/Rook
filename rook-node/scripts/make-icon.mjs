/** Generates the Rook Node source icon (1024x1024 PNG) for `tauri icon`. */
import fs from "node:fs";
import zlib from "node:zlib";

const SIZE = 1024;

// CRC32 for PNG chunks.
const table = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c;
}
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// Rook theme: deep ink background, warm paper rook glyph.
const BG = [26, 29, 35];
const FG = [246, 245, 241];

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // no filter
  for (let x = 0; x < SIZE; x += 1) {
    const nx = x / SIZE;
    const ny = y / SIZE;
    // Rounded-square mask.
    const margin = 0.09, radius = 0.16;
    const insideOuter =
      nx > margin && nx < 1 - margin && ny > margin && ny < 1 - margin;
    const cx = Math.max(Math.min(nx, 1 - margin - radius), margin + radius);
    const cy = Math.max(Math.min(ny, 1 - margin - radius), margin + radius);
    const dist = Math.hypot(nx - cx, ny - cy);
    const inside = insideOuter || dist <= radius;
    let color = [0, 0, 0, 0];
    if (inside) color = [...BG, 255];
    // Rook silhouette: crenellated tower centered.
    const px = (nx - 0.5) * 2, py = (ny - 0.5) * 2;
    const inTower =
      (py > -0.42 && py < -0.28 && ((px > -0.42 && px < -0.26) || (px > -0.08 && px < 0.08) || (px > 0.26 && px < 0.42))) || // battlements
      (py >= -0.28 && py < -0.16 && px > -0.42 && px < 0.42) || // top band
      (py >= -0.16 && py < 0.18 && px > -0.3 && px < 0.3) || // body
      (py >= 0.18 && py < 0.28 && px > -0.2 && px < 0.2) || // neck taper
      (py >= 0.28 && py < 0.46 && px > -0.38 && px < 0.38); // base
    if (inside && inTower) color = [...FG, 255];
    const off = rowStart + 1 + x * 4;
    raw[off] = color[0];
    raw[off + 1] = color[1];
    raw[off + 2] = color[2];
    raw[off + 3] = color[3];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync("src-tauri/icons/app-icon.png", png);
console.log(`wrote src-tauri/icons/app-icon.png (${Math.round(png.length / 1024)} KB)`);
