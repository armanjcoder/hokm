import { normalizeApiUrl, parseStoredSession, type StoredSession } from '../lib.js';

/** Browser storage for the player session and the chosen API origin. */

const SESSION_KEY = 'hokm.session';
const API_URL_KEY = 'hokm.apiUrl';

export function saveSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(API_URL_KEY, session.apiUrl);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function readSession(apiUrl: string): StoredSession | null {
  return parseStoredSession(localStorage.getItem(SESSION_KEY), apiUrl);
}

export function rememberApiUrl(apiUrl: string): void {
  localStorage.setItem(API_URL_KEY, apiUrl);
}

/** Falls back to the dev server pairing when running `vite dev` directly. */
export function defaultApiUrl(): string {
  if (location.hostname === 'localhost' && location.port === '5173') {
    return 'http://localhost:4000';
  }
  return location.origin;
}

/**
 * The bot appends `?api=` so the Mini App knows which tunnel to talk to.
 * That value wins over anything stored previously.
 */
export function resolveInitialApiUrl(fallback: string): string {
  const apiFromUrl = new URLSearchParams(location.search).get('api');
  if (apiFromUrl) {
    const normalized = normalizeApiUrl(apiFromUrl);
    rememberApiUrl(normalized);
    return normalized;
  }
  return normalizeApiUrl(localStorage.getItem(API_URL_KEY) || fallback);
}
