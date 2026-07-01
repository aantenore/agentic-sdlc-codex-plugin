#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};

function main() {
  writePng("assets/icon.png", drawIcon(512, "standard"));
  writePng("assets/logo.png", drawLogo(1024, 512, "light"));
  writePng("assets/logo-dark.png", drawLogo(1024, 512, "dark"));
  writePng("skills/agentic-sdlc/assets/icon-small.png", drawIcon(128, "standard"));
  writePng("skills/agentic-sdlc/assets/icon-large.png", drawIcon(512, "standard"));
}

function drawIcon(size, variant) {
  const image = createImage(size, size);
  const dark = variant === "dark";
  forEachPixel(image, (x, y) => {
    const t = (x + y) / (size * 2);
    const glow = radial(x, y, size * 0.28, size * 0.24, size * 0.58);
    return mix(
      dark ? [5, 18, 28, 255] : [7, 29, 42, 255],
      [14, 165, 233, 255],
      clamp(t * 0.28 + glow * 0.22),
    );
  });
  drawDiagonalGrid(image, [255, 255, 255, 16], size / 9);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.32;
  const nodes = [
    ["D", -90, [14, 165, 233, 255]],
    ["A", -30, [34, 197, 94, 255]],
    ["D", 30, [245, 158, 11, 255]],
    ["I", 90, [14, 165, 233, 255]],
    ["V", 150, [34, 197, 94, 255]],
    ["R", 210, [245, 158, 11, 255]],
  ].map(([label, angle, color]) => {
    const radians = (Number(angle) * Math.PI) / 180;
    return {
      label,
      x: cx + Math.cos(radians) * radius,
      y: cy + Math.sin(radians) * radius,
      color,
    };
  });
  for (let index = 0; index < nodes.length; index += 1) {
    const current = nodes[index];
    const next = nodes[(index + 1) % nodes.length];
    drawLine(image, current.x, current.y, next.x, next.y, size * 0.018, [207, 250, 254, 120]);
  }
  drawRoundedRect(image, cx - size * 0.19, cy - size * 0.24, size * 0.38, size * 0.48, size * 0.035, [2, 8, 23, 210]);
  drawRoundedRect(image, cx - size * 0.15, cy - size * 0.18, size * 0.3, size * 0.06, size * 0.015, [226, 232, 240, 230]);
  drawRoundedRect(image, cx - size * 0.15, cy - size * 0.06, size * 0.3, size * 0.045, size * 0.014, [148, 163, 184, 230]);
  drawRoundedRect(image, cx - size * 0.15, cy + size * 0.04, size * 0.2, size * 0.045, size * 0.014, [148, 163, 184, 210]);
  drawLine(image, cx - size * 0.1, cy + size * 0.16, cx - size * 0.02, cy + size * 0.23, size * 0.022, [34, 197, 94, 255]);
  drawLine(image, cx - size * 0.02, cy + size * 0.23, cx + size * 0.13, cy + size * 0.08, size * 0.022, [34, 197, 94, 255]);
  for (const node of nodes) {
    drawCircle(image, node.x, node.y, size * 0.061, [2, 8, 23, 220]);
    drawCircle(image, node.x, node.y, size * 0.046, node.color);
  }
  return image;
}

function drawLogo(width, height, variant) {
  const image = createImage(width, height);
  const dark = variant === "dark";
  forEachPixel(image, (x, y) => {
    const t = x / width;
    const glow = radial(x, y, width * 0.22, height * 0.35, width * 0.38);
    return mix(
      dark ? [3, 7, 18, 255] : [241, 245, 249, 255],
      dark ? [14, 165, 233, 255] : [14, 165, 233, 255],
      clamp(glow * 0.18 + t * 0.08),
    );
  });
  const icon = drawIcon(Math.floor(height * 0.72), dark ? "dark" : "standard");
  blit(image, icon, Math.floor(height * 0.14), Math.floor(height * 0.14));
  const textColor = dark ? [226, 232, 240, 255] : [15, 23, 42, 255];
  const accent = [14, 165, 233, 255];
  drawBitmapText(image, "AGENTIC", Math.floor(width * 0.46), Math.floor(height * 0.27), Math.floor(height * 0.024), textColor);
  drawBitmapText(image, "SDLC", Math.floor(width * 0.46), Math.floor(height * 0.5), Math.floor(height * 0.044), accent);
  drawLine(image, width * 0.44, height * 0.76, width * 0.86, height * 0.76, height * 0.012, dark ? [148, 163, 184, 180] : [51, 65, 85, 140]);
  drawCircle(image, width * 0.44, height * 0.76, height * 0.025, [34, 197, 94, 255]);
  drawCircle(image, width * 0.62, height * 0.76, height * 0.025, [14, 165, 233, 255]);
  drawCircle(image, width * 0.86, height * 0.76, height * 0.025, [245, 158, 11, 255]);
  return image;
}

function createImage(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function forEachPixel(image, colorFn) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      setPixel(image, x, y, colorFn(x, y));
    }
  }
}

function setPixel(image, x, y, color) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) {
    return;
  }
  const index = (iy * image.width + ix) * 4;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = color[3];
}

function blendPixel(image, x, y, color) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) {
    return;
  }
  const index = (iy * image.width + ix) * 4;
  const alpha = color[3] / 255;
  image.data[index] = Math.round(color[0] * alpha + image.data[index] * (1 - alpha));
  image.data[index + 1] = Math.round(color[1] * alpha + image.data[index + 1] * (1 - alpha));
  image.data[index + 2] = Math.round(color[2] * alpha + image.data[index + 2] * (1 - alpha));
  image.data[index + 3] = 255;
}

function drawCircle(image, cx, cy, radius, color) {
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius) {
        blendPixel(image, x, y, color);
      }
    }
  }
}

function drawLine(image, x1, y1, x2, y2, thickness, color) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.6);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    drawCircle(image, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thickness / 2, color);
  }
}

function drawRoundedRect(image, x, y, width, height, radius, color) {
  const minX = Math.floor(x);
  const maxX = Math.ceil(x + width);
  const minY = Math.floor(y);
  const maxY = Math.ceil(y + height);
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const dx = Math.max(x - px, 0, px - (x + width));
      const dy = Math.max(y - py, 0, py - (y + height));
      if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(image, px, py, color);
      }
    }
  }
}

function drawDiagonalGrid(image, color, spacing) {
  for (let start = -image.height; start < image.width; start += spacing) {
    drawLine(image, start, image.height, start + image.height, 0, Math.max(1, image.width * 0.003), color);
  }
}

function drawBitmapText(image, text, x, y, scale, color) {
  let cursor = x;
  for (const char of text) {
    if (char === " ") {
      cursor += scale * 4;
      continue;
    }
    const glyph = GLYPHS[char];
    if (!glyph) {
      cursor += scale * 4;
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          drawRoundedRect(image, cursor + column * scale, y + row * scale, scale * 0.82, scale * 0.82, scale * 0.12, color);
        }
      }
    }
    cursor += scale * 6;
  }
}

function blit(target, source, offsetX, offsetY) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (y * source.width + x) * 4;
      blendPixel(target, offsetX + x, offsetY + y, [
        source.data[index],
        source.data[index + 1],
        source.data[index + 2],
        source.data[index + 3],
      ]);
    }
  }
}

function mix(left, right, t) {
  return [
    Math.round(left[0] + (right[0] - left[0]) * t),
    Math.round(left[1] + (right[1] - left[1]) * t),
    Math.round(left[2] + (right[2] - left[2]) * t),
    Math.round(left[3] + (right[3] - left[3]) * t),
  ];
}

function radial(x, y, cx, cy, radius) {
  return clamp(1 - Math.hypot(x - cx, y - cy) / radius);
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function writePng(relativePath, image) {
  const filePath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const raw = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (image.width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < image.width * 4; x += 1) {
      raw[rowStart + 1 + x] = image.data[y * image.width * 4 + x];
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr(image.width, image.height)),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

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

main();
