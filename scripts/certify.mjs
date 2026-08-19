/**
 * Certification gate.
 *
 * Replaces validate-palette.mjs, which computed the same contrast sweep but
 * only ever called console.warn — it never set an exit code, and its culori
 * import was optional, so a run that checked nothing was indistinguishable
 * from a run that passed. It reported 166 sub-AA minutes on every push for
 * the lifetime of the package and blocked nothing.
 *
 * Every schedule shipped or referenced by this repo is swept once per second.
 * Before 0.3 this ran per minute, because whole-minute rounding was what kept
 * a polarity swap from ever being rendered. Jumps are now declared on the stop
 * and never interpolated, so the guarantee no longer depends on how often we
 * look — and sampling finer simply makes the check sharper.
 */
import {
  contrastRatio,
  contrastThreshold,
  findContrastViolations,
  findRenderedPathViolations,
  isOutOfSrgbGamut,
  sampleSchedule
} from '../dist/testing.js';
import { createFixtureSystem } from './fixture.mjs';

// Sample every second, not every minute. Before 0.3 the crossing guarantee
// rested on whole-minute rounding, so a finer sweep would have reported the
// swap as a failure. Now that jumps are declared and never interpolated,
// sampling finer simply makes the check stricter.
const STEP = 1 / 60;
import { demoThemeSystem } from '../examples/vanilla-dom/theme-system.js';
import dawnToDusk from '../dist/presets/dawn-to-dusk.js';
import tidal from '../dist/presets/tidal.js';
import contrastFirst from '../dist/presets/contrast-first.js';
import paper from '../dist/presets/paper.js';

// Every schedule this repo ships or demonstrates. The vanilla-dom demo is the
// one recorded in the README, so a contrast failure there is one users see
// before they have installed anything.
const subjects = [
  { label: 'validation-fixture', system: createFixtureSystem() },
  { label: 'examples/vanilla-dom', system: demoThemeSystem },
  // Presets are a claim that a palette is good and safe. The claim is only
  // worth making because this gate can refuse it.
  { label: 'preset/dawn-to-dusk', system: dawnToDusk },
  { label: 'preset/tidal', system: tidal },
  { label: 'preset/contrast-first', system: contrastFirst },
  { label: 'preset/paper', system: paper }
];

const formatMinute = (minute) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Collapses per-minute violations into contiguous windows for readability. */
function toWindows(violations) {
  const windows = [];
  let current = null;
  for (const violation of violations) {
    if (current && violation.minute === current.end + 1) {
      current.end = violation.minute;
      if (violation.actual < current.worst.actual) {
        current.worst = violation;
      }
      continue;
    }
    current = {
      start: violation.minute,
      end: violation.minute,
      worst: violation
    };
    windows.push(current);
  }
  return windows;
}

let failed = false;

for (const { label, system } of subjects) {
  const problems = [];

  // 1. Resolution must never throw, and must stay in sRGB gamut.
  let samples = [];
  try {
    samples = sampleSchedule(system, { stepMinutes: STEP });
  } catch (error) {
    problems.push(`resolve threw: ${error.message}`);
  }

  const outOfGamut = [];
  for (const snapshot of samples) {
    for (const [key, color] of Object.entries(snapshot.tokens)) {
      if (isOutOfSrgbGamut(color)) {
        outOfGamut.push({ minute: snapshot.minute, key });
      }
    }
  }
  if (outOfGamut.length > 0) {
    const first = outOfGamut[0];
    problems.push(
      `${outOfGamut.length} out-of-gamut token value(s), first "${first.key}" at ${formatMinute(first.minute)}`
    );
  }

  // 2. Static light/dark fallbacks are reachable via setMode() and are never
  //    visited by the time-aware sweep, so they need checking explicitly.
  for (const variant of ['light', 'dark']) {
    const tokens = system.staticThemes[variant];
    for (const [key, color] of Object.entries(tokens)) {
      if (isOutOfSrgbGamut(color)) {
        problems.push(
          `staticThemes.${variant}.${key} is outside the sRGB gamut`
        );
      }
    }
    for (const role of system.roles) {
      const bg = tokens[role.bg];
      const fg = tokens[role.fg];
      if (!bg || !fg) {
        continue;
      }
      const actual = contrastRatio(bg, fg);
      const required = contrastThreshold(role.min);
      if (actual + 1e-9 < required) {
        problems.push(
          `staticThemes.${variant}: contrast ${actual.toFixed(2)}:1 (needs ` +
            `${required}:1) for "${role.fg}" on "${role.bg}"`
        );
      }
    }
  }

  // 3. Every declared role pair must meet its declared level, every minute.
  const violations = findContrastViolations(system, { stepMinutes: STEP });
  for (const window of toWindows(violations)) {
    const { worst } = window;
    problems.push(
      `contrast ${worst.actual.toFixed(2)}:1 (needs ${worst.required}:1) for ` +
        `"${worst.fg}" on "${worst.bg}" from ${formatMinute(window.start)} to ` +
        `${formatMinute(window.end)}; worst at ${formatMinute(worst.minute)} ` +
        `(${worst.phase} -> ${worst.nextPhase}, t=${worst.progress.toFixed(2)})`
    );
  }

  // 4. What a CSS transition would paint between consecutive minutes. The
  //    three checks above prove our values are clean and say nothing about the
  //    frames a browser draws on the way from one to the next.
  const painted = findRenderedPathViolations(system);
  if (painted.length > 0) {
    const worst = painted.reduce((a, b) => (b.actual < a.actual ? b : a));
    problems.push(
      `a transition would paint ${worst.actual.toFixed(2)}:1 (needs ` +
        `${worst.required}:1) for "${worst.fg}" on "${worst.bg}" between ` +
        `${formatMinute(worst.minute)} and the next minute, on ` +
        `${painted.length} frame(s)`
    );
  }

  if (problems.length === 0) {
    console.log(
      `PASS  ${label}: ${(1440 / STEP).toLocaleString()} samples (per second), ${system.roles.length} role pair(s)`
    );
  } else {
    failed = true;
    console.error(`FAIL  ${label}`);
    for (const problem of problems) {
      console.error(`        ${problem}`);
    }
  }
}

if (failed) {
  console.error('\nCertification failed.');
  process.exitCode = 1;
} else {
  console.log('\nCertification passed.');
}
