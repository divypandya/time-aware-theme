import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, relative, resolve } from 'node:path';

/**
 * Measures the transitive cost of each entry point, not just its own file.
 *
 * tsup emits shared chunks, so an entry file can be a few hundred bytes of
 * re-exports while the code a consumer actually downloads sits in chunks it
 * imports. Measuring the entry alone would let every budget pass while
 * measuring nothing.
 *
 * Budgets are ceilings to design against, not targets to fill. WCAG and sRGB
 * conversion maths must stay in the testing and inspect entries and never
 * reach core, dom, or the presets.
 */
const budgets = [
  { file: 'dist/index.js', limit: 6144, label: 'core entry' },
  { file: 'dist/dom.js', limit: 6656, label: 'DOM entry' },
  { file: 'dist/react.js', limit: 7168, label: 'React entry' },
  { file: 'dist/react-ui.js', limit: 9216, label: 'React UI entry' },
  { file: 'dist/testing.js', limit: 8192, label: 'testing entry' },
  { file: 'dist/inspect.js', limit: 8192, label: 'inspect entry' },
  {
    file: 'dist/solve.js',
    limit: 9216,
    label: 'solve entry (build-time only)'
  },
  { file: 'dist/tailwind.js', limit: 2048, label: 'Tailwind entry' },
  {
    file: 'dist/presets/dawn-to-dusk.js',
    limit: 7168,
    label: 'preset entry (dawn-to-dusk)'
  }
];

const IMPORT_PATTERN = /(?:from|import)\s*["'](\.[^"']+)["']/g;

/** Collects an entry and every local chunk it reaches, transitively. */
function closure(entry) {
  const seen = new Set();
  const queue = [resolve(entry)];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      if (!specifier) {
        continue;
      }
      queue.push(resolve(dirname(file), specifier));
    }
  }

  return [...seen].sort();
}

let failed = false;

for (const budget of budgets) {
  const files = closure(budget.file);
  // Concatenate before gzipping: summing per-file gzip sizes overstates the
  // total, since the compressor cannot share a dictionary across files.
  const combined = Buffer.concat(files.map((file) => readFileSync(file)));
  const bytes = gzipSync(combined).length;
  const chunkNote =
    files.length > 1 ? ` (${files.length} files incl. shared chunks)` : '';

  if (bytes > budget.limit) {
    console.error(
      `${budget.label} exceeds budget: ${bytes} > ${budget.limit} bytes gzip${chunkNote}`
    );
    for (const file of files) {
      console.error(`    ${relative(process.cwd(), file)}`);
    }
    failed = true;
  } else {
    console.log(`${budget.label}: ${bytes} bytes gzip${chunkNote}`);
  }
}

if (failed) {
  process.exitCode = 1;
}
