// Renders desktop/assets/*.svg to the PNGs and .icns the app needs, drawing
// them on a canvas in Electron's own Chromium. Run with: npm run build:icons
import { app, BrowserWindow } from 'electron';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const assets = join(import.meta.dirname, '..', 'desktop', 'assets');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const render = async (svgFile, size) => {
    const svg = Buffer.from(readFileSync(join(assets, svgFile))).toString('base64');
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${size};
        canvas.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;base64,${svg}';
    })`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };

  writeFileSync(join(assets, 'trayTemplate.png'), await render('tray.svg', 16));
  writeFileSync(join(assets, 'trayTemplate@2x.png'), await render('tray.svg', 32));

  const iconset = join(assets, 'icon.iconset');
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), await render('icon.svg', size));
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), await render('icon.svg', size * 2));
  }
  writeFileSync(join(assets, 'icon.png'), await render('icon.svg', 1024));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(assets, 'icon.icns')]);
  rmSync(iconset, { recursive: true, force: true });
  app.quit();
});
