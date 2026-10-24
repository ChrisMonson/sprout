import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';

// Inside the desktop app the window has no title bar, so the page provides the
// drag areas and room for the window buttons.
if (navigator.userAgent.includes('Electron')) document.documentElement.classList.add('desktop');

// Paint in the last theme shown (or the system's) before settings arrive, so dark mode doesn't flash light.
try {
  document.documentElement.dataset.theme = localStorage.getItem('sprout-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
} catch { /* storage can be unavailable; the theme still applies once settings load */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
