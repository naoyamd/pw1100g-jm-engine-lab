import { access, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// Vinext writes assetPrefix as a directory. Pages already supplies that prefix.
const root = resolve('dist/client');
const prefixed = resolve(root, 'pw1100g-jm-engine-lab');
if (!prefixed.startsWith(root + sep))
  throw new Error('Invalid public asset path');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
if (
  !html.includes('PW1100G') ||
  !html.includes('/pw1100g-jm-engine-lab/_next/')
) {
  throw new Error('Expected a complete GitHub Pages static export');
}
await rename(resolve(prefixed, '_next'), resolve(root, '_next'));
await rmdir(prefixed); // Empty directory only; never delete source files.
for (const [, asset] of html.matchAll(
  /(?:src|href)="(\/pw1100g-jm-engine-lab\/_next\/[^"?#]+)"/g,
)) {
  await access(resolve(root, asset.replace('/pw1100g-jm-engine-lab/', '')));
}
await writeFile(resolve(root, '.nojekyll'), '');
console.log('Static HTML and every entry asset verified for GitHub Pages.');
