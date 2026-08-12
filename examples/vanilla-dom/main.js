import { resolveThemeSnapshot } from '../../dist/index.js';
import { createThemeController } from '../../dist/dom.js';
import { demoThemeSystem } from './theme-system.js';

const controller = createThemeController({
  system: demoThemeSystem,
  document,
  window,
  defaultMode: 'time-aware'
});
controller.start();

const slider = document.querySelector('#minute-slider');
const playButton = document.querySelector('#play-button');
const clockLabel = document.querySelector('#clock-label');
const phaseLabel = document.querySelector('#phase-label');
const modeButtons = document.querySelectorAll('[data-mode]');
const swatchEls = {
  background: document.querySelector('#swatch-background'),
  foreground: document.querySelector('#swatch-foreground'),
  accent: document.querySelector('#swatch-accent')
};

let mode = 'time-aware';
let playing = false;
let rafId = null;

function formatMinute(minute) {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const mins = String(minute % 60).padStart(2, '0');
  return `${hours}:${mins}`;
}

function oklchCss(token) {
  return `oklch(${token.l} ${token.c} ${token.h ?? 0} / ${token.alpha})`;
}

function render(minute) {
  const snapshot = resolveThemeSnapshot(demoThemeSystem, mode, minute);

  clockLabel.textContent = formatMinute(minute);
  phaseLabel.textContent = `${snapshot.phase} · ${mode}`;

  for (const [key, el] of Object.entries(swatchEls)) {
    el.style.backgroundColor = oklchCss(snapshot.tokens[key]);
  }

  modeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
}

function currentLiveMinute() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

slider.value = String(currentLiveMinute());
render(slider.valueAsNumber);

slider.addEventListener('input', () => {
  mode = 'time-aware';
  controller.setMode('time-aware');
  controller.setPreviewMinute(slider.valueAsNumber);
  render(slider.valueAsNumber);
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    controller.setMode(mode);
    if (mode === 'time-aware') {
      controller.setPreviewMinute(slider.valueAsNumber);
    }
    render(slider.valueAsNumber);
  });
});

function stepPlayback() {
  if (!playing) {
    return;
  }
  const next = (slider.valueAsNumber + 4) % 1440;
  slider.value = String(next);
  controller.setPreviewMinute(next);
  render(next);
  rafId = requestAnimationFrame(stepPlayback);
}

playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.textContent = playing ? 'Pause' : '▶ Play 24h';
  playButton.setAttribute('aria-pressed', String(playing));

  if (playing) {
    mode = 'time-aware';
    controller.setMode('time-aware');
    stepPlayback();
  } else if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
});
