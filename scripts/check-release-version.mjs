import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const tag = process.env.INPUT_TAG || process.env.GITHUB_REF_NAME || '';
const expectedTag = `time-aware-theme-v${pkg.version}`;

if (!tag) {
  throw new Error(`Missing release tag. Expected ${expectedTag}.`);
}

if (tag !== expectedTag) {
  throw new Error(
    `Tag/version mismatch: expected ${expectedTag}, received ${tag}`
  );
}

console.log(`Release tag verified: ${expectedTag}`);
