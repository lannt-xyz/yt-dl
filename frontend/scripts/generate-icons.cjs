// Sinh icon PWA (PNG) từ SVG bằng Chrome/Chromium qua Playwright.
// Chạy: node scripts/generate-icons.cjs   (cần Chrome cài sẵn hoặc `npx playwright install chromium`)
const { chromium } = require("@playwright/test");
const path = require("node:path");

const BG = "#6d5efc";
// 9 cột waveform, chiều cao theo tỉ lệ; vẽ trong ô 100x100
const BARS = [22, 38, 58, 78, 92, 70, 50, 34, 20];

function svg({ size, scale = 1, rounded = false }) {
  const pad = (100 - 100 * scale) / 2;
  const barW = 5.2 * scale;
  const gap = 3.2 * scale;
  const total = BARS.length * barW + (BARS.length - 1) * gap;
  const x0 = 50 - total / 2;
  const bars = BARS.map((h, i) => {
    const hh = h * 0.62 * scale;
    const x = x0 + i * (barW + gap);
    return `<rect x="${x}" y="${50 - hh / 2}" width="${barW}" height="${hh}" rx="${barW / 2}" fill="#fff"/>`;
  }).join("");
  void pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <rect width="100" height="100" ${rounded ? 'rx="22"' : ""} fill="${BG}"/>${bars}</svg>`;
}

const targets = [
  ["icon-192.png", { size: 192, rounded: true }],
  ["icon-512.png", { size: 512, rounded: true }],
  // maskable: nội dung nằm trong vùng an toàn 80% ở giữa, nền tràn viền
  ["icon-maskable-512.png", { size: 512, scale: 0.78 }],
  // iOS tự bo góc nên để nền tràn viền
  ["apple-touch-icon.png", { size: 180 }],
];

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
  const page = await browser.newPage();
  for (const [name, opts] of targets) {
    await page.setViewportSize({ width: opts.size, height: opts.size });
    await page.setContent(`<body style="margin:0;background:transparent">${svg(opts)}</body>`);
    await page.screenshot({
      path: path.join(__dirname, "..", "public", "icons", name),
      omitBackground: true,
      clip: { x: 0, y: 0, width: opts.size, height: opts.size },
    });
    console.log("wrote", name);
  }
  await browser.close();
})();
