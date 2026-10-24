import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';

// Inside the desktop app the window has no title bar, so the page provides the
// drag areas and room for the window buttons.
if (navigator.userAgent.includes('Electron')) document.documentElement.classList.add('desktop');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
