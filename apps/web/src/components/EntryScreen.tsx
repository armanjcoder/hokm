import type { ReactNode } from 'react';
import type { GameMode } from '@hokm/game-engine';
import type { StoredSession } from '../lib.js';
import type { ConnectionStatus, RoomView, SessionPhase } from '../types.js';
import { Landing } from './Landing.js';
import { ResumingScreen } from './ResumingScreen.js';

interface LandingProps {
  name: string;
  setName: (name: string) => void;
  joinCode: string;
  setJoinCode: (code: string) => void;
  apiUrl: string;
  setApiUrl: (url: string) => void;
  loading: boolean;
  createRoom: () => void;
  joinRoom: () => void;
  toast: string;
  mode: GameMode;
  setMode: (mode: GameMode) => void;
  showRules: () => void;
  targetScore: number;
  setTargetScore: (score: number) => void;
  resumeSession: () => void;
  showProfile: () => void;
  initData: string;
}

/**
 * Screens shown before the player is seated: the landing page and the
 * "returning to your table" spinner. Returns null once a table is joined.
 */
export function renderEntryScreen({
  sessionPhase,
  room,
  session,
  savedSession,
  connection,
  rulesOverlay,
  cancelResume,
  forgetSession,
  landing,
  profileOverlay,
}: {
  sessionPhase: SessionPhase;
  room: RoomView | null;
  session: StoredSession | null;
  savedSession: StoredSession | null;
  connection: ConnectionStatus;
  rulesOverlay: ReactNode;
  /** The player's profile card, openable before any table is joined. */
  profileOverlay?: ReactNode;
  cancelResume: () => void;
  forgetSession: (message?: string) => void;
  landing: LandingProps;
}): ReactNode {
  // Re-joining a saved table: show progress instead of a blank screen.
  if (sessionPhase === 'resuming' && !room) {
    return (
      <>
        <ResumingScreen
          roomId={session?.roomId ?? savedSession?.roomId ?? ''}
          connection={connection}
          cancel={cancelResume}
          forget={() => forgetSession('نشست قبلی پاک شد. حالا می‌تونی میز جدید بسازی.')}
        />
        {rulesOverlay}
        {profileOverlay}
      </>
    );
  }

  if (!room || !session) {
    return (
      <>
        <Landing
          {...landing}
          savedSession={savedSession}
          linkedRoomId={new URLSearchParams(location.search).get('room') ?? ''}
          clearSavedSession={() => forgetSession('نشست قبلی پاک شد. حالا می‌تونی میز جدید بسازی.')}
        />
        {rulesOverlay}
        {profileOverlay}
      </>
    );
  }

  return null;
}
