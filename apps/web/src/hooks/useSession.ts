import { useState } from 'react';
import { normalizeApiUrl, type StoredSession } from '../lib.js';
import {
  clearSession,
  readSession,
  rememberApiUrl,
  resolveInitialApiUrl,
  saveSession,
} from '../api/session-storage.js';
import type { SessionPhase } from '../types.js';

export interface SessionController {
  apiUrl: string;
  /** The session currently in use, or null while on the landing screen. */
  session: StoredSession | null;
  /** The session remembered in storage, used for the "resume table" card. */
  savedSession: StoredSession | null;
  phase: SessionPhase;
  setPhase: (phase: SessionPhase) => void;
  /** Establishes an active session and mirrors it into the resume card state. */
  activate: (next: StoredSession) => void;
  /** Applies a token the server issued for an existing session. */
  upgradeToken: (token: string) => void;
  /** Drops the session everywhere and returns the user to the landing screen. */
  forget: () => void;
  /** Re-enters the remembered table. */
  resume: () => void;
  /** Abandons an in-progress resume without clearing storage. */
  cancelResume: () => void;
  updateApiUrl: (nextUrl: string) => void;
  markActive: () => void;
}

/** Owns the player session, its persistence and the API origin it belongs to. */
export function useSession(defaultApiUrl: string): SessionController {
  const initialApiUrl = resolveInitialApiUrl(defaultApiUrl);
  const [apiUrl, setApiUrl] = useState(initialApiUrl);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [savedSession, setSavedSession] = useState<StoredSession | null>(() => readSession(initialApiUrl));
  const [phase, setPhase] = useState<SessionPhase>('idle');

  return {
    apiUrl,
    session,
    savedSession,
    phase,
    setPhase,

    activate(next) {
      saveSession(next);
      setSession(next);
      setSavedSession(next);
      setPhase('active');
    },

    upgradeToken(token) {
      setSession((current) => {
        if (!current) return current;
        const upgraded = { ...current, token };
        saveSession(upgraded);
        setSavedSession(upgraded);
        return upgraded;
      });
    },

    forget() {
      clearSession();
      setSession(null);
      setSavedSession(null);
      setPhase('idle');
    },

    resume() {
      setSavedSession((current) => {
        if (current) {
          setPhase('resuming');
          setSession(current);
        }
        return current;
      });
    },

    cancelResume() {
      setSession(null);
      setPhase('idle');
    },

    markActive() {
      setPhase('active');
    },

    updateApiUrl(nextUrl) {
      const normalized = normalizeApiUrl(nextUrl);
      setApiUrl(normalized);
      rememberApiUrl(normalized);
      setSession((current) => {
        if (!current) return current;
        const next = { ...current, apiUrl: normalized };
        saveSession(next);
        return next;
      });
    },
  };
}
