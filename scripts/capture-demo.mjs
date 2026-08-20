/**
 * Regenerates the README animations.
 *
 * Frames are captured from a real headless browser running the real
 * createThemeController, so what the README shows is what the package actually
 * produces — the same claim the README makes about the recording. Nothing here
 * hand-draws a palette.
 *
 * The previous demo.gif was recorded before v0.2.0 and shows the old schedule,
 * including the two windows that rendered invisible text. Regenerating it is
 * part of the accessibility fix, not decoration.
 *
 * Usage: npm run demo:gif
 */
import { createReadStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'assets');
const TMP = join(ROOT, '.demo-frames');

// 96 frames at 15-minute steps: a full day that stays under a sensible file
// size. Finer steps mostly add bytes, since consecutive minutes differ by very
// little.
const STEP_MINUTES = 15;
const FPS = 12;
const WIDTH = 720;
const HEIGHT = 420;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json'
};

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const filePath = join(ROOT, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream'
    });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      done({ server, port: server.address().port });
    });
  });
}

function run(cmd, args) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`${cmd} exited ${code}`))
    );
  });
}

/**
 * Two-pass GIF encode. A global palette generated from the whole sequence
 * avoids the banding a single-pass encode produces on smooth OKLCH gradients,
 * which is most of what these animations are showing.
 */
async function encodeGif(frameDir, outFile) {
  const palette = join(frameDir, 'palette.png');
  const input = join(frameDir, 'frame-%04d.png');
  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    input,
    '-vf',
    'palettegen=max_colors=192:stats_mode=full',
    palette
  ]);
  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    input,
    '-i',
    palette,
    '-lavfi',
    'paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    '-loop',
    '0',
    outFile
  ]);
}

async function capture(page, url, frameDir, { ready, render }) {
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(ready, { timeout: 15_000 });

  let index = 0;
  for (let minute = 0; minute < 1440; minute += STEP_MINUTES) {
    await page.evaluate(render, minute);
    // The controller applies preview updates through a scheduler; give it a
    // frame to land before grabbing pixels.
    await page.waitForTimeout(40);
    await page.screenshot({
      path: join(frameDir, `frame-${String(index).padStart(4, '0')}.png`)
    });
    index += 1;
  }
  return index;
}

const { server, port } = await serve();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();

try {
  mkdirSync(OUT, { recursive: true });

  const targets = [
    {
      label: 'demo',
      url: `${base}/examples/vanilla-dom/index.html`,
      out: join(OUT, 'demo.gif'),
      viewport: { width: 640, height: 620 },
      // Driven through the example's own slider rather than a capture hook, so
      // the example stays free of tooling-only code and the recording really is
      // the demo a visitor can run.
      ready: () => Boolean(document.querySelector('#minute-slider')),
      render: (minute) => {
        const slider = document.querySelector('#minute-slider');
        slider.value = String(minute);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    ...[
      'dawn-to-dusk',
      'tidal',
      'contrast-first',
      'paper',
      'nocturne',
      'ember',
      'forest',
      'meridian',
      'blossom',
      'slate'
    ].map((id) => ({
      label: `preset-${id}`,
      url: `${base}/scripts/preset-demo.html?preset=${id}`,
      out: join(OUT, `preset-${id}.gif`),
      viewport: { width: WIDTH, height: HEIGHT },
      ready: () => window.__ready === true,
      render: (minute) => window.renderMinute(minute)
    }))
  ];

  for (const target of targets) {
    const page = await browser.newPage({
      viewport: target.viewport,
      deviceScaleFactor: 1
    });
    const frames = await capture(page, target.url, TMP, {
      ready: target.ready,
      render: target.render
    });
    await encodeGif(TMP, target.out);
    await page.close();
    console.log(`${target.label}: ${frames} frames -> ${target.out}`);
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
  await browser.close();
  server.close();
}
