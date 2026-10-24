// Runs the greenhouse from a terminal (`npm run dev`), with the UI hot-reloading
// in the browser. The desktop app starts the same greenhouse from desktop/.

import { PORT } from './paths.ts';
import { startGreenhouse } from './start.ts';
import { setPlatform, cliPlatform } from './platform.ts';
import { ensureBrowser } from './runtime.ts';
import { AlreadyRunning } from './lock.ts';

setPlatform(cliPlatform);
await ensureBrowser();

try {
  const greenhouse = await startGreenhouse({ port: PORT, web: 'vite' });
  const shutdown = async () => {
    await greenhouse.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  if (!(err instanceof AlreadyRunning)) throw err;
  console.error(err.message);
  process.exit(1);
}
