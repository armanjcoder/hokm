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
import { RulesGuide } from './components/RulesGuide.js';
import { TableScreen } from './components/TableScreen.js';
import { renderEntryScreen } from './components/EntryScreen.js';
import { shareRoom } from './api/share.js';
import { announceReady } from './api/telegram-sdk.js';

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
  const [targetScore, setTargetScore] = useState(7);
  const [rulesFor, setRulesFor] = useState<GameMode | null>(null);
  const autoJoinAttempted = useRef(false);

  const socket = useMemo<Socket>(() => createGameSocket(apiUrl), [apiUrl]);
  const me = room?.players.find((p) => p.id === session?.playerId);
  const game = room?.game;

  useEffect(() => {
    announceReady();
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
      const nextRoom = await createRoomRequest(apiUrl, name, initData, mode, targetScore);
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

  const { chooseSuit, play, nextHand, requestRedeal, discard, draw, resolveDraw, requireConnection } = useGameActions({
    socket,
    session,
    game,
    connection,
    setToast,
  });

  const {
    toggleReady,
    updateSettings,
    addBot,
    setBotDifficulty,
    removeBot,
    leaveRoom,
    busy: lobbyBusy,
  } = useLobbyActions({
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
    <RulesGuide
      mode={rulesFor}
      lowHandRedeal={Boolean(room?.rules?.lowHandRedeal)}
      bam={Boolean(room?.rules?.bam)}
      onClose={() => setRulesFor(null)}
    />
  ) : null;

  const entry = renderEntryScreen({
    sessionPhase,
    room,
    session,
    savedSession,
    connection,
    rulesOverlay,
    cancelResume: () => sessionCtl.cancelResume(),
    forgetSession,
    landing: {
      name, setName, joinCode, setJoinCode, apiUrl,
      setApiUrl: updateApiUrl, loading, createRoom, joinRoom, toast,
      mode, setMode, showRules: () => setRulesFor(mode),
      targetScore, setTargetScore, resumeSession,
    },
  });
  if (entry) return entry;
  // `renderEntryScreen` only returns null once both are present, but TypeScript
  // cannot see through the call, so narrow explicitly.
  if (!room || !session) return null;

  return (
    <TableScreen
      room={room}
      session={session}
      me={me}
      game={game}
      apiUrl={apiUrl}
      connection={connection}
      toast={toast}
      starting={starting}
      lobbyBusy={lobbyBusy}
      rulesOverlay={rulesOverlay}
      setToast={setToast}
      showRules={() => setRulesFor(room.mode ?? 'classic4')}
      onNewTable={() => forgetSession('میز قبلی رها شده بود. حالا می‌تونی میز جدید بسازی.')}
      lobby={{ toggleReady, addBot, setBotDifficulty, removeBot, leaveRoom, updateSettings }}
      table={{ chooseSuit, play, nextHand, requestRedeal, discard, draw, resolveDraw }}
      invite={() => shareRoom(room.id, apiUrl)}
    />
  );
}
