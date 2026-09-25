import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { IconScreen } from './views/IconScreen';
import './styles/theme.css';

// `#icon` shows only the orb, for capturing the app icon (`npm run app:icon`).
const iconOnly = window.location.hash === '#icon';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{iconOnly ? <IconScreen /> : <App />}</StrictMode>,
);
