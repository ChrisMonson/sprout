// Installs the dependencies every sprout uses into build/runtime, so the app
// can ship them and never needs npm on the person's Mac.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const out = join(root, 'build', 'runtime');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'runtime', 'package.json'), join(out, 'package.json'));
// The @sprout/greenhouse dependency is file:./.runtime/sdk, relative to the install.
cpSync(join(root, 'runtime', 'sdk'), join(out, '.runtime', 'sdk'), { recursive: true });
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error', '--install-links=false'], { cwd: out, stdio: 'inherit' });
console.log('Built build/runtime/node_modules.');
