// 開発用：build/icon.svg からアプリのアイコン（PNG・ICO）を作る
// 使い方: node scripts/make-icons.mjs   （Playwright の Chromium を使う）
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const svg = readFileSync('build/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const pngs = {};
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${s}" height="${s}"`)}</body></html>`);
  pngs[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await browser.close();
writeFileSync('build/icon.png', pngs[512]);
writeFileSync('src/assets/icon.png', pngs[256]);
writeFileSync('src/assets/icon-32.png', pngs[32]);
// ICO（中身は PNG）
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((s, i) => {
  const b = pngs[s];
  const e = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, e);
  header.writeUInt8(s >= 256 ? 0 : s, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(b.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += b.length;
});
writeFileSync('build/icon.ico', Buffer.concat([header, ...icoSizes.map((s) => pngs[s])]));
console.log('icons written');
