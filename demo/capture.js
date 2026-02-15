const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const FRAMES_DIR = path.join(__dirname, 'frames');
const HTML_PATH = path.join(__dirname, 'chat.html');
const FPS = 12;
const INTERVAL = Math.round(1000 / FPS);

async function main() {
  // Clean and create frames dir
  if (fs.existsSync(FRAMES_DIR)) {
    fs.rmSync(FRAMES_DIR, { recursive: true });
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
  });

  await page.goto(`file://${HTML_PATH}`, { waitUntil: 'domcontentloaded' });

  let frame = 0;
  const pad = (n) => String(n).padStart(5, '0');

  console.log(`Capturing at ${FPS}fps (${INTERVAL}ms intervals)...`);

  while (true) {
    const outPath = path.join(FRAMES_DIR, `frame-${pad(frame)}.png`);
    await page.screenshot({ path: outPath });
    frame++;

    const done = await page.evaluate(() => window.ANIMATION_DONE);
    if (done) {
      // Capture a few extra frames for the final state
      for (let i = 0; i < FPS; i++) {
        const extraPath = path.join(FRAMES_DIR, `frame-${pad(frame)}.png`);
        await page.screenshot({ path: extraPath });
        frame++;
      }
      break;
    }

    await new Promise((r) => setTimeout(r, INTERVAL));
  }

  console.log(`Captured ${frame} frames`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
