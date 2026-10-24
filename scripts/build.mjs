// Builds what the desktop app runs: the UI (dist/web) and the main and
// greenhouse processes (dist/desktop). Run with: npm run build
import { build as buildWeb } from 'vite';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** esbuild options for the desktop bundles; also used by scripts/dev-desktop.mjs. */
export function desktopBuild(root) {
  return {
    entryPoints: ['main', 'greenhouse', 'selftest'].map(name => join(root, 'desktop', `${name}.ts`)),
    outdir: join(root, 'dist', 'desktop'),
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: true,
    logLevel: 'warning',
    // Loaded from node_modules at runtime: Electron itself, the Agent SDK (which
    // finds its Claude binary next to it), and terminal/dev-only tools.
    external: ['electron', '@anthropic-ai/claude-agent-sdk', 'playwright', 'vite', '@vitejs/plugin-react'],
    banner: { js: "import { createRequire as __sproutRequire } from 'node:module'; const require = __sproutRequire(import.meta.url);" },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(import.meta.dirname, '..');
  await buildWeb({
    root: join(root, 'web'),
    configFile: false,
    plugins: [react()],
    logLevel: 'warn',
    build: { outDir: join(root, 'dist', 'web'), emptyOutDir: true },
  });
  await build(desktopBuild(root));
  console.log('Built dist/web and dist/desktop.');
}
