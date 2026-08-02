import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { loadTelegramSdk } from './api/telegram-sdk.js';
import './styles.css';

/**
 * The Telegram SDK is fetched from `telegram.org`, which is blocked on some
 * networks. We wait for it only briefly and render regardless, so a blocked
 * CDN can never leave the user on a blank screen.
 */
loadTelegramSdk().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
