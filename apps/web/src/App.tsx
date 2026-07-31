import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  HokmRequestError,
  normalizeApiUrl,
  parseJoinInput,
  parseStoredSession,
  socketPayload,
  userMessage,
  type StoredSession,
} from './lib.js';
import type { GameMode } from '@hokm/game-engine';
import type { ConnectionStatus, RoomView } from './types.js';
import { createGameSocket } from './api/socket.js';
import { defaultApiUrl } from './api/session-storage.js';
import { useRoomConnection } from './hooks/useRoomConnection.js';
import { useGameActions } from './hooks/useGameActions.js';
import { useSession } from './hooks/useSession.js';
import { useLobbyActions } from './hooks/useLobbyActions.js';
import { createRoomRequest, joinRoomRequest } from './api/client.js';
import { GameTable } from './components/GameTable.js';
import { Landing } from './components/Landing.js';
import { Lobby } from './components/Lobby.js';
import { ResumingScreen } from './components/ResumingScreen.js';
import { StartOverlay } from './components/StartOverlay.js';
import { TopBar } from './components/TopBar.js';
import { AbandonedNotice } from './components/AbandonedNotice.js';
import { Toast } from './components/Toast.js';
import { RulesGuide } from './components/RulesGuide.js';
import { shareRoom } from './api/share.js';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || defaultApiUrl();

export function App() {
  // `initDataUnsafe` is only used for prefilling the display name. Identity is
  // proven server-side from the signed `initData` string.
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const initData = window.Telegram?.WebApp?.initData ?? '';
  const defaultName = tgUser?.first_name || tgUser?.username || 'بازیکن حکم';
  const sessionCtl = useSession(DEFAULT_API_URL);
  const { apiUrl, session, savedSession, phase: sessionPhase } = sessionCtl;
  const [name, setName] = useState(defaultName);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [joinCode, setJoinCode] = useState(new URLSearchParams(location.search).get('room') ?? '');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [starting, setStarting] = useState(false);
  const [mode, setMode] = useState<GameMode>('classic4');
  const [rulesFor, setRulesFor] = useState<GameMode | null>(null);
  const autoJoinAttempted = useRef(false);

  const socket = useMemo<Socket>(() => createGameSocket(apiUrl), [apiUrl]);
  const me = room?.players.find((p) => p.id === session?.playerId);
  const game = room?.game;

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => setStarting(false), 2200);
    return () => clearTimeout(timer);
  }, [starting]);

  useRoomConnection({
    session,
    socket,
    onConnectionChange: setConnection,
    onRoom: (nextRoom) => {
      setRoom(nextRoom);
      sessionCtl.markActive();
    },
    onRoomUpdate: (nextRoom) =>
      setRoom((previous) => {
        // Everyone at the table sees the start animation, not just the last
        // player who pressed ready.
        if (previous?.status === 'lobby' && nextRoom.status === 'playing') setStarting(true);
        return nextRoom;
      }),
    onTokenUpgrade: (token) => sessionCtl.upgradeToken(token),
    onSessionInvalid: (message) => forgetSession(message),
    onRoomMissing: (message) => {
      setJoinCode('');
      forgetSession(message);
    },
    onJoinError: (response) => {
      sessionCtl.cancelResume();
      setToast(userMessage(response, 'ارتباط با میز برقرار نشد. بک‌اند را روشن و آدرس API را چک کن.'));
    },
  });

  const activateSession = sessionCtl.activate;
  const updateApiUrl = sessionCtl.updateApiUrl;
  const resumeSession = sessionCtl.resume;

  /** Drops the session and shows why the player was returned to the landing screen. */
  function forgetSession(message?: string) {
    sessionCtl.forget();
    setRoom(null);
    if (message) setToast(message);
  }

  async function createRoom() {
    setLoading(true);
    try {
      const nextRoom = await createRoomRequest(apiUrl, name, initData, mode);
      const player = nextRoom.players[0];
      activateSession({ roomId: nextRoom.id, playerId: player.id, apiUrl, token: nextRoom.token });
      setRoom(nextRoom);
      setToast('میز ساخته شد؛ کد یا لینک رو برای دوستات بفرست.');
    } catch (error) {
      setToast(
        error instanceof HokmRequestError
          ? error.message
          : 'ساخت میز انجام نشد. بک‌اند یا آدرس API را چک کن.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!savedSession && joinCode && !autoJoinAttempted.current) {
      autoJoinAttempted.current = true;
      void joinRoom();
    }
  }, []);

  async function joinRoom() {
    const parsed = parseJoinInput(joinCode);
    if (parsed.apiUrl) updateApiUrl(parsed.apiUrl);
    const targetApiUrl = normalizeApiUrl(parsed.apiUrl ?? apiUrl);
    if (!parsed.roomId) return;

    setLoading(true);
    try {
      const data = await joinRoomRequest(targetApiUrl, parsed.roomId, name, initData);
      activateSession({
        roomId: data.room.id,
        playerId: data.player.id,
        apiUrl: targetApiUrl,
        token: data.token ?? data.player?.token,
      });
      setRoom(data.room);
    } catch (error) {
      if (error instanceof HokmRequestError && error.code === 'ROOM_NOT_FOUND') {
        forgetSession(
          'این میز روی سرور پیدا نشد. احتمالاً لینک قدیمی است یا بک‌اند بعد از ساخت میز ری‌استارت شده. لطفاً در ربات /newgame بزن و لینک جدید را باز کن.',
        );
      } else if (error instanceof HokmRequestError) {
        setToast(error.message);
      } else {
        setToast('اتصال به میز انجام نشد. اینترنت، آدرس API یا لینک میز را چک کن.');
      }
    } finally {
      setLoading(false);
    }
  }

  const { chooseSuit, play, nextHand, discard, draw, resolveDraw, requireConnection } = useGameActions({
    socket,
    session,
    game,
    connection,
    setToast,
  });

  const { toggleReady, addBot, removeBot, leaveRoom, busy: lobbyBusy } = useLobbyActions({
    apiUrl,
    room,
    session,
    me,
    requireConnection,
    setToast,
    onGameStarted: () => setStarting(true),
    onLeft: () => forgetSession('از میز خارج شدی.'),
  });

  // The rules guide must be reachable from every screen, including the landing
  // page before any room exists, so it is rendered alongside each branch.
  const rulesOverlay = rulesFor ? (
    <RulesGuide mode={rulesFor} onClose={() => setRulesFor(null)} />
  ) : null;

  // Re-joining a saved table: show progress instead of a blank screen.
  if (sessionPhase === 'resuming' && !room) {
    return (
      <>
        <ResumingScreen
          roomId={session?.roomId ?? savedSession?.roomId ?? ''}
          connection={connection}
          cancel={() => sessionCtl.cancelResume()}
          forget={() => forgetSession('نشست قبلی پاک شد. حالا می‌تونی میز جدید بسازی.')}
        />
        {rulesOverlay}
      </>
    );
  }

  if (!room || !session) {
    return (
      <>
        <Landing
          name={name}
          setName={setName}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          apiUrl={apiUrl}
          setApiUrl={updateApiUrl}
          loading={loading}
          createRoom={createRoom}
          joinRoom={joinRoom}
          toast={toast}
          mode={mode}
          setMode={setMode}
          showRules={() => setRulesFor(mode)}
          savedSession={savedSession}
          linkedRoomId={new URLSearchParams(location.search).get('room') ?? ''}
          resumeSession={resumeSession}
          clearSavedSession={() => forgetSession('نشست قبلی پاک شد. حالا می‌تونی میز جدید بسازی.')}
        />
        {rulesOverlay}
      </>
    );
  }

  return (
    <main className="app-shell">
      <TopBar room={room} me={me} apiUrl={apiUrl} connection={connection} />
      {room.status === 'lobby' && (
        <Lobby
          room={room}
          me={me}
          isHost={room.hostPlayerId === session.playerId}
          toggleReady={toggleReady}
          addBot={addBot}
          removeBot={removeBot}
          leaveRoom={leaveRoom}
          busy={lobbyBusy}
          invite={() => shareRoom(room.id, apiUrl)}
          showRules={() => setRulesFor(room.mode ?? 'classic4')}
        />
      )}
      {room.status === 'abandoned' && (
        <AbandonedNotice
          onNewTable={() => forgetSession('میز قبلی رها شده بود. حالا می‌تونی میز جدید بسازی.')}
        />
      )}
      {room.status !== 'lobby' && room.status !== 'abandoned' && game && (
        <GameTable
          room={room}
          game={game}
          meId={session.playerId}
          chooseSuit={chooseSuit}
          play={play}
          nextHand={nextHand}
          discard={discard}
          draw={draw}
          resolveDraw={resolveDraw}
        />
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      {starting && <StartOverlay />}
      {rulesOverlay}
    </main>
  );
}

