import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

// Budgets are ceilings to design against, not targets to fill. The core budget
// rose from 4,608 B in v0.1.0 to absorb role normalization, the authoring-time
// swap lint, and holdThenSnap() — all of which run at defineThemeSystem() time
// and carry deliberately verbose error messages, since a message that names the
// offending stop pair is the difference between a fix and a bug report.
//
// WCAG/sRGB conversion math lives in dist/testing.js and must never migrate
// into the core or DOM bundles.
const budgets = [
  { file: 'dist/index.js', limit: 5632, label: 'core + DOM entry bundle' },
  { file: 'dist/dom.js', limit: 3328, label: 'DOM bundle' },
  { file: 'dist/react.js', limit: 1024, label: 'React bundle' },
  { file: 'dist/testing.js', limit: 3072, label: 'testing bundle' }
];

let failed = false;

for (const budget of budgets) {
  const bytes = gzipSync(readFileSync(resolve(budget.file))).length;
  if (bytes > budget.limit) {
    console.error(
      `${budget.label} exceeds budget: ${bytes} > ${budget.limit} bytes gzip`
    );
    failed = true;
  } else {
    console.log(`${budget.label}: ${bytes} bytes gzip`);
  }
}

if (failed) {
  process.exitCode = 1;
}
