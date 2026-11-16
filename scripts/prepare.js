import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const tsdown = resolve(dirname(require.resolve('tsdown/package.json')), 'bin', 'tsdown.js');
execFileSync(process.execPath, [tsdown], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [resolve(root, 'scripts', 'build-desktop-core.mjs')], { cwd: root, stdio: 'inherit' });
