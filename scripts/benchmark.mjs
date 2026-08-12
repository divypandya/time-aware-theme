import { performance } from 'node:perf_hooks';
import { createFixtureSystem } from './fixture.mjs';
import { resolveThemeAt } from '../dist/index.js';

const system = createFixtureSystem();
const iterations = 10_000;
const samples = [];

for (let i = 0; i < iterations; i += 1) {
  const minute = i % 1_440;
  const start = performance.now();
  resolveThemeAt(system, minute);
  samples.push(performance.now() - start);
}

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const p95 = samples[Math.floor(samples.length * 0.95)];

console.log(JSON.stringify({ medianMs: median, p95Ms: p95 }, null, 2));
if (median > 1 || p95 > 3) {
  process.exitCode = 1;
}
