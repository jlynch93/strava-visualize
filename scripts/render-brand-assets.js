// Renders Runlore's raster brand assets (app icons and the social share image)
// from public/brand/runlore-mark.svg using Playwright's Chromium.
// Run after changing the mark: node scripts/render-brand-assets.js
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const publicDir = path.resolve(__dirname, "../public");
const mark = fs.readFileSync(path.join(publicDir, "brand/runlore-mark.svg"), "utf8");
const markUri = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;
const FONT = 'Aptos, "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif';

// Square app icons fill the whole canvas (platforms apply their own rounding).
function iconHtml(size) {
  return `<!doctype html><html><body style="margin:0;background:#0e1a1f">
    <img src="${markUri}" style="display:block;width:${size}px;height:${size}px;transform:scale(1.08)"></body></html>`;
}

// Faint topographic rings echo the mark behind the share card.
function shareHtml() {
  const rings = Array.from({ length: 7 }, (_, index) => {
    const scale = 1 + index * 0.34;
    return `<ellipse cx="0" cy="0" rx="${150 * scale}" ry="${112 * scale}" />`;
  }).join("");
  return `<!doctype html><html><head><style>
    body { margin: 0; width: 1200px; height: 630px; background: #0d181c; color: #f3f6ef; font-family: ${FONT}; overflow: hidden; position: relative; }
    .topo { position: absolute; right: -140px; top: -60px; opacity: .55; }
    .rule { position: absolute; top: 0; left: 0; right: 0; height: 8px; background: #c8f04a; }
    .content { position: absolute; left: 88px; top: 150px; }
    .lockup { display: flex; align-items: center; gap: 30px; }
    .lockup img { width: 128px; height: 128px; }
    .wordmark { font-size: 116px; font-weight: 780; letter-spacing: -0.045em; line-height: 1; }
    .tagline { margin-top: 52px; font-size: 46px; font-weight: 600; letter-spacing: -0.02em; color: #dfe7da; }
    .sub { margin-top: 16px; font-size: 28px; color: #9fb6b4; }
    .url { position: absolute; left: 88px; bottom: 64px; font-size: 26px; font-weight: 700; color: #c8f04a; letter-spacing: .01em; }
  </style></head><body>
    <div class="rule"></div>
    <svg class="topo" width="760" height="760" viewBox="-380 -380 760 760" fill="none" stroke="#2c5a56" stroke-width="3">
      <g transform="rotate(-24)">${rings}</g><circle cx="10" cy="-6" r="20" fill="#c8f04a" stroke="none" opacity=".9"/>
    </svg>
    <div class="content">
      <div class="lockup"><img src="${markUri}" alt=""><span class="wordmark">runlore</span></div>
      <div class="tagline">Every run adds to the story.</div>
      <div class="sub">Training trends, fitness and plans from Strava and Garmin.</div>
    </div>
    <div class="url">runlore.app</div>
  </body></html>`;
}

async function render(browser, html, width, height, output) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: path.join(publicDir, output), clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log(`Rendered ${output} (${width}x${height})`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    await render(browser, iconHtml(180), 180, 180, "apple-touch-icon.png");
    await render(browser, iconHtml(192), 192, 192, "brand/icon-192.png");
    await render(browser, iconHtml(512), 512, 512, "brand/icon-512.png");
    await render(browser, shareHtml(), 1200, 630, "brand/og-image.png");
  } finally {
    await browser.close();
  }
})();
