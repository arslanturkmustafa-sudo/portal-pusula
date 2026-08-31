import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const outputDirectory = resolve("public/icons");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const a = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
  const b = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
  const c = 1 - a - b;
  return a >= 0 && b >= 0 && c >= 0;
}

function createIcon(size, maskable = false) {
  const rowLength = size * 4 + 1;
  const raw = Buffer.alloc(rowLength * size);
  const center = (size - 1) / 2;
  const safeScale = maskable ? 0.72 : 0.88;
  const radius = size * 0.36 * safeScale;

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const nx = (x - center) / size;
      const ny = (y - center) / size;
      const distance = Math.hypot(x - center, y - center);
      const glow = Math.max(0, 1 - Math.hypot(nx - 0.24, ny + 0.28) * 1.7);

      let red = Math.round(16 + glow * 26);
      let green = Math.round(44 + glow * 30);
      let blue = Math.round(42 + glow * 25);

      if (distance < radius && distance > radius * 0.91) {
        red = 244;
        green = 239;
        blue = 228;
      }

      const north = insideTriangle(
        x,
        y,
        [center, center - radius * 0.72],
        [center - radius * 0.23, center + radius * 0.12],
        [center + radius * 0.23, center + radius * 0.12],
      );
      const south = insideTriangle(
        x,
        y,
        [center, center + radius * 0.72],
        [center - radius * 0.23, center - radius * 0.12],
        [center + radius * 0.23, center - radius * 0.12],
      );

      if (north) {
        red = 236;
        green = 107;
        blue = 61;
      } else if (south) {
        red = 244;
        green = 239;
        blue = 228;
      }

      if (distance < radius * 0.085) {
        red = 16;
        green = 44;
        blue = 42;
      }

      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const outputs = [
  ["portal-pusula-192-v1.png", 192, false],
  ["portal-pusula-512-v1.png", 512, false],
  ["portal-pusula-maskable-512-v1.png", 512, true],
];

await mkdir(outputDirectory, { recursive: true });
for (const [name, size, maskable] of outputs) {
  const path = resolve(outputDirectory, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, createIcon(size, maskable));
}

