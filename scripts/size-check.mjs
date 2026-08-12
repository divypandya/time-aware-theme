import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const budgets = [
  { file: 'dist/index.js', limit: 2560, label: 'core + DOM + react + testing entry bundle' },
  { file: 'dist/dom.js', limit: 2560, label: 'DOM bundle' },
  { file: 'dist/react.js', limit: 1536, label: 'React bundle' }
];

let failed = false;

for (const budget of budgets) {
  const bytes = gzipSync(readFileSync(resolve(budget.file))).length;
  if (bytes > budget.limit) {
    console.error(`${budget.label} exceeds budget: ${bytes} > ${budget.limit} bytes gzip`);
    failed = true;
  } else {
    console.log(`${budget.label}: ${bytes} bytes gzip`);
  }
}

if (failed) {
  process.exitCode = 1;
}

