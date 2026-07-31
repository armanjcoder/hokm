import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import type { Card, PublicGameView, Suit } from '@hokm/game-engine';
import './styles.css';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || defaultApiUrl();
const suits: Array<{ id: Suit; label: string; symbol: string; color: string }> = [
  { id: 'spades', label: 'پیک', symbol: '♠', color: 'black' },
  { id: 'hearts', label: 'دل', symbol: '♥', color: 'red' },
  { id: 'diamonds', label: 'خشت', symbol: '♦', color: 'red' },
  { id: 'clubs', label: 'گشنیز', symbol: '♣', color: 'black' },
];

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        /** Raw signed payload. This is the only value the backend trusts. */
        initData?: string;
        initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
      };
    };
  }
}

type RoomStatus = 'lobby' | 'playing' | 'finished' | 'abandoned';
interface RoomPlayer { id: string; name: string; telegramId?: number; seat: number; connected: boolean; ready?: boolean; isBot?: boolean }
interface Readiness { waitingOn: string[]; humanCount: number; botCount: number; canStart: boolean }
interface RoomView {
  id: string;
  code: string;
  status: RoomStatus;
  hostPlayerId?: string;
  readiness?: Readiness;
  players: RoomPlayer[];
  game?: PublicGameView;
}
interface StoredSession { roomId: string; playerId: string; apiUrl: string; token?: string }
type ConnectionStatus = 'connecting' | 'connected' | 'offline';
/**
 * `idle`     -> a saved session exists but we have not tried to use it yet
 * `resuming` -> actively re-joining the saved table
 * `active`   -> we are in the table
 */
type SessionPhase = 'idle' | 'resuming' | 'active';

function App() {
  // `initDataUnsafe` is only used for prefilling the display name. Identity is
  // proven server-side from the signed `initData` string.
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const initData = window.Telegram?.WebApp?.initData ?? '';
  const defaultName = tgUser?.first_name || tgUser?.username || 'بازیکن حکم';
  const initialApiUrl = resolveInitialApiUrl();
  const [apiUrl, setApiUrlState] = useState(initialApiUrl);
  const [name, setName] = useState(defaultName);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [joinCode, setJoinCode] = useState(new URLSearchParams(location.search).get('room') ?? '');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [savedSession, setSavedSession] = useState<StoredSession | null>(() => readSession(initialApiUrl));
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('idle');
  const [starting, setStarting] = useState(false);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const autoJoinAttempted = useRef(false);

  const socket = useMemo<Socket>(
    () =>
      io(apiUrl, {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        // Spreads retries out so every client does not hammer the tunnel at once.
        randomizationFactor: 0.5,
        timeout: 10000,
      }),
    [apiUrl],
  );
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

  useEffect(() => {
    if (!session) return;

    // Re-joining must happen on *every* connect, not just the first one:
    // after a reconnect the socket is a brand new one and is no longer a member
    // of the Socket.IO room, so it would silently stop receiving room:update.
    const joinRoomOverSocket = () => {
      setConnection('connected');
      socket.emit('room:join', socketPayload(session), (response: any) => {
        if (response?.ok && response.room) {
          setRoom(response.room);
          setSessionPhase('active');
          const upgraded =
            typeof response.token === 'string' && response.token !== session.token
              ? { ...session, token: response.token }
              : session;
          saveSession(upgraded);
          setSavedSession(upgraded);
          if (upgraded !== session) setSession(upgraded);
          return;
        }
        if (response?.ok === false) {
          if (response.error === 'INVALID_SESSION' || response.error === 'PLAYER_NOT_FOUND') {
            forgetSession('نشست تو دیگر معتبر نیست. احتمالاً میز پاک شده یا صندلی‌ات آزاد شده. یک میز جدید بساز یا با کد میز دوباره وارد شو.');
            return;
          }
          if (response.error === 'ROOM_NOT_FOUND') {
            setJoinCode('');
            forgetSession('میز قبلی روی سرور پیدا نشد؛ احتمالاً دیتابیس پاک شده یا لینک قدیمی است. در ربات /newgame بزن.');
            return;
          }
          setSessionPhase('idle');
          setSession(null);
          setToast(userMessage(response, 'ارتباط با میز برقرار نشد. بک‌اند را روشن و آدرس API را چک کن.'));
        }
      });
    };

    const handleDisconnect = () => setConnection('offline');
    const handleReconnectAttempt = () => setConnection('connecting');
    const handleRoomUpdate = (nextRoom: RoomView) => {
      setRoom((previous) => {
        // Everyone at the table sees the start animation, not just the last
        // player who pressed ready.
        if (previous?.status === 'lobby' && nextRoom.status === 'playing') setStarting(true);
        return nextRoom;
      });
    };

    socket.on('connect', joinRoomOverSocket);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleDisconnect);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('room:update', handleRoomUpdate);

    setConnection(socket.connected ? 'connected' : 'connecting');
    if (socket.connected) joinRoomOverSocket();
    else socket.connect();

    return () => {
      socket.off('connect', joinRoomOverSocket);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleDisconnect);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('room:update', handleRoomUpdate);
      socket.disconnect();
    };
  }, [session, socket]);

  /** Establishes an active session and mirrors it into the resume card state. */
  function activateSession(next: StoredSession) {
    saveSession(next);
    setSession(next);
    setSavedSession(next);
    setSessionPhase('active');
  }

  /** Drops the session everywhere and returns the user to the landing screen. */
  function forgetSession(message?: string) {
    clearSession();
    setSession(null);
    setSavedSession(null);
    setRoom(null);
    setSessionPhase('idle');
    if (message) setToast(message);
  }

  function resumeSession() {
    if (!savedSession) return;
    setSessionPhase('resuming');
    setSession(savedSession);
  }

  function updateApiUrl(nextUrl: string) {
    const normalized = normalizeApiUrl(nextUrl);
    setApiUrlState(normalized);
    localStorage.setItem('hokm.apiUrl', normalized);
    if (session) {
      const nextSession = { ...session, apiUrl: normalized };
      saveSession(nextSession);
      setSession(nextSession);
    }
  }

  async function createRoom() {
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName: name, ...(initData ? { initData } : {}) }),
      });
      const nextRoom = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new HokmRequestError(nextRoom?.error ?? 'CREATE_FAILED', userMessage(nextRoom, 'ساخت میز انجام نشد. بک‌اند یا آدرس API را چک کن.'));
      }
      const player = nextRoom.players[0];
      const nextSession: StoredSession = { roomId: nextRoom.id, playerId: player.id, apiUrl, token: nextRoom.token };
      activateSession(nextSession);
      setRoom(nextRoom);
      setToast('میز ساخته شد؛ کد یا لینک رو برای دوستات بفرست.');
    } catch (error) {
      setToast(error instanceof HokmRequestError ? error.message : 'ساخت میز انجام نشد. بک‌اند یا آدرس API را چک کن.');
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
    const roomId = parsed.roomId;
    if (!roomId) return;
    setLoading(true);
    try {
      const response = await fetch(`${targetApiUrl}/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...(initData ? { initData } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new HokmRequestError(data?.error ?? 'JOIN_FAILED', userMessage(data, 'اتصال به میز انجام نشد. آدرس API یا لینک میز را چک کن.'));
      }
      const nextSession: StoredSession = { roomId: data.room.id, playerId: data.player.id, apiUrl: targetApiUrl, token: data.token ?? data.player?.token };
      activateSession(nextSession);
      setRoom(data.room);
    } catch (error) {
      if (error instanceof HokmRequestError && error.code.startsWith('TELEGRAM_AUTH')) {
        setToast(error.message);
      } else if (error instanceof HokmRequestError && error.code === 'ROOM_NOT_FOUND') {
        forgetSession('این میز روی سرور پیدا نشد. احتمالاً لینک قدیمی است یا بک‌اند بعد از ساخت میز ری‌استارت شده. لطفاً در ربات /newgame بزن و لینک جدید را باز کن.');
      } else if (error instanceof HokmRequestError) {
        setToast(error.message);
      } else {
        setToast('اتصال به میز انجام نشد. اینترنت، آدرس API یا لینک میز را چک کن.');
      }
    } finally {
      setLoading(false);
    }
  }

  /** Shared POST helper for the lobby actions, all of which are session-authed. */
  async function lobbyAction(path: string, extra: Record<string, unknown> = {}, fallback = 'این کار انجام نشد.') {
    if (!room || !session) return undefined;
    if (!requireConnection()) return undefined;
    setLobbyBusy(true);
    try {
      const response = await fetch(`${apiUrl}/rooms/${room.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...socketPayload(session), ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast(userMessage(data, fallback));
        return undefined;
      }
      return data;
    } catch {
      setToast('ارتباط با سرور برقرار نشد. بک‌اند و آدرس API را چک کن.');
      return undefined;
    } finally {
      setLobbyBusy(false);
    }
  }

  async function toggleReady() {
    const next = !me?.ready;
    const data = await lobbyAction('ready', { ready: next }, 'ثبت آمادگی انجام نشد.');
    if (data?.started) setStarting(true);
  }

  async function addBot() {
    const data = await lobbyAction('add-bot', {}, 'اضافه کردن ربات انجام نشد.');
    if (data?.started) setStarting(true);
  }

  function removeBot(botId: string) {
    void lobbyAction('remove-bot', { botId }, 'حذف ربات انجام نشد.');
  }

  async function leaveRoom() {
    const data = await lobbyAction('leave', {}, 'خروج از میز انجام نشد.');
    if (data) forgetSession('از میز خارج شدی.');
  }

  function chooseSuit(suit: Suit) {
    if (!session) return;
    if (!requireConnection()) return;
    socket.emit('game:choose_trump', { ...socketPayload(session), suit }, ackToast);
  }

  function play(card: Card) {
    if (!session || !game?.validCardIds.includes(card.id)) return;
    if (!requireConnection()) return;
    socket.emit('game:play_card', { ...socketPayload(session), cardId: card.id }, ackToast);
  }

  function nextHand() {
    if (!session) return;
    if (!requireConnection()) return;
    socket.emit('game:next_hand', socketPayload(session), ackToast);
  }

  /** Blocks moves that would be silently dropped while the socket is down. */
  function requireConnection(): boolean {
    if (connection === 'connected') return true;
    setToast('ارتباط با سرور قطع است. تا وصل شدن دوباره صبر کن.');
    return false;
  }

  function ackToast(response: any) {
    if (response?.ok === false) setToast(userMessage(response, 'این حرکت انجام نشد. دوباره تلاش کن.'));
  }

  // Re-joining a saved table: show progress instead of a blank screen.
  if (sessionPhase === 'resuming' && !room) {
    return (
      <ResumingScreen
        roomId={session?.roomId ?? savedSession?.roomId ?? ''}
        connection={connection}
        cancel={() => { setSession(null); setSessionPhase('idle'); }}
        forget={() => forgetSession('نشست قبلی پاک شد. حالا می‌تونی میز جدید بسازی.')}
      />
    );
  }

  if (!room || !session) {
    return (
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
        savedSession={savedSession}
        linkedRoomId={new URLSearchParams(location.search).get('room') ?? ''}
        resumeSession={resumeSession}
        clearSavedSession={() => forgetSession('نشست قبلی پاک شد. حالا می‌تونی میز جدید بسازی.')}
      />
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
        />
      )}
      {room.status === 'abandoned' && (
        <section className="panel">
          <h2>این میز رها شده است</h2>
          <p>همه بازیکنان میز را ترک کرده‌اند. یک میز جدید بساز.</p>
          {/* Purely local: the server rejects actions on an abandoned table. */}
          <button
            className="primary"
            type="button"
            onClick={() => forgetSession('میز قبلی رها شده بود. حالا می‌تونی میز جدید بسازی.')}
          >
            ساخت میز جدید
          </button>
        </section>
      )}
      {room.status !== 'lobby' && room.status !== 'abandoned' && game && (
        <GameTable
          room={room}
          game={game}
          meId={session.playerId}
          chooseSuit={chooseSuit}
          play={play}
          nextHand={nextHand}
        />
      )}
      {toast && (
        <button className="toast" type="button" role="alert" onClick={() => setToast('')}>
          {toast}
        </button>
      )}
      {starting && <StartOverlay />}
    </main>
  );
}

function ResumingScreen({ roomId, connection, cancel, forget }: {
  roomId: string; connection: ConnectionStatus; cancel: () => void; forget: () => void;
}) {
  return (
    <main className="landing">
      <section className="hero-card resume-screen">
        <div className="brand"><span>♠</span> Hokm Club</div>
        <div className="spinner" aria-hidden="true" />
        <h1>در حال برگشتن به میز…</h1>
        <p>
          {connection === 'connected'
            ? 'داریم صندلی قبلی‌ات را پس می‌گیریم.'
            : 'در حال اتصال به سرور. اگر بک‌اند خاموش است، روشنش کن؛ خودکار دوباره تلاش می‌کنیم.'}
        </p>
        <code className="room-id">{roomId}</code>
        <div className="actions-grid">
          <button className="ghost full-width" type="button" onClick={cancel}>لغو و برگشت به صفحه اول</button>
          <button className="ghost full-width" type="button" onClick={forget}>پاک کردن نشست و ساخت میز جدید</button>
        </div>
      </section>
    </main>
  );
}

function Landing(props: {
  name: string; setName: (name: string) => void; joinCode: string; setJoinCode: (code: string) => void;
  apiUrl: string; setApiUrl: (url: string) => void; loading: boolean; createRoom: () => void; joinRoom: () => void; toast: string;
  savedSession: StoredSession | null; linkedRoomId: string; resumeSession: () => void; clearSavedSession: () => void;
}) {
  const linkPointsElsewhere = Boolean(props.linkedRoomId) && props.linkedRoomId !== props.savedSession?.roomId;
  return (
    <main className="landing">
      {props.savedSession && (
        <section className="resume-card">
          <h2>میز قبلی‌ات باز است 👑</h2>
          <p>
            {linkPointsElsewhere
              ? 'یک نشست ذخیره‌شده داری، ولی لینکی که باز کردی مربوط به میز دیگری است. انتخاب کن: به میز قبلی برگرد، یا نشست را پاک کن و با دکمه ورود به میز جدید برو.'
              : 'یک نشست ذخیره‌شده داری. می‌تونی به همان صندلی برگردی.'}
          </p>
          <code className="room-id">{props.savedSession.roomId}</code>
          <div className="resume-actions">
            <button className="primary" type="button" onClick={props.resumeSession}>ادامه بازی</button>
            <button className="ghost" type="button" onClick={props.clearSavedSession}>میز جدید</button>
          </div>
        </section>
      )}
      <section className="hero-card">
        <div className="brand"><span>♠</span> Hokm Club</div>
        <h1>حکم ایرانی، آنلاین، سریع و شیک.</h1>
        <p>میز ۴ نفره بساز، دوستات رو دعوت کن، حکم کن و دست‌ها رو ببر 👑</p>
        <label>اسم نمایشی</label>
        <input value={props.name} onChange={(e) => props.setName(e.target.value)} maxLength={40} />
        <details className="advanced-settings">
          <summary>تنظیم بک‌اند محلی</summary>
          <label>آدرس HTTPS بک‌اند / Cloudflare Tunnel</label>
          <input dir="ltr" value={props.apiUrl} onChange={(e) => props.setApiUrl(e.target.value)} placeholder="https://your-api.trycloudflare.com" />
          <small>اگر از لینک بات وارد شوی، این مقدار خودکار تنظیم می‌شود.</small>
        </details>
        <div className="actions-grid">
          <button className="primary" disabled={props.loading} onClick={props.createRoom}>ساخت میز جدید</button>
          <div className="join-box">
            <input placeholder="کد یا لینک میز" value={props.joinCode} onChange={(e) => props.setJoinCode(e.target.value)} />
            <button onClick={props.joinRoom} disabled={props.loading}>ورود</button>
          </div>
        </div>
      </section>
      {props.toast && <div className="toast">{props.toast}</div>}
    </main>
  );
}

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connected: 'آنلاین',
  connecting: 'در حال اتصال دوباره…',
  offline: 'آفلاین',
};

function TopBar({ room, me, apiUrl, connection }: { room: RoomView; me: RoomPlayer | undefined; apiUrl: string; connection: ConnectionStatus }) {
  return (
    <header className="topbar">
      <div><strong>Hokm Club</strong><small>میز {room.code}</small></div>
      <div className="topbar-actions">
        <span className={`api-dot ${connection}`} title={`${CONNECTION_LABELS[connection]} — ${apiUrl}`} />
        <div className="pill">{me ? `صندلی ${me.seat + 1}` : 'تماشاچی'}</div>
      </div>
      {connection !== 'connected' && (
        <div className={`connection-banner ${connection}`} role="status">
          {connection === 'connecting'
            ? 'ارتباط قطع شد؛ در حال اتصال دوباره به میز…'
            : 'اتصال برقرار نیست. بک‌اند یا اینترنت را چک کن؛ خودکار دوباره تلاش می‌کنیم.'}
        </div>
      )}
    </header>
  );
}

function StartOverlay() {
  return (
    <div className="start-overlay" role="status" aria-live="polite">
      <div className="start-overlay__card">
        <div className="start-overlay__suits">
          {suits.map((suit, index) => (
            <span key={suit.id} className={`start-suit ${suit.color}`} style={{ animationDelay: `${index * 0.12}s` }}>
              {suit.symbol}
            </span>
          ))}
        </div>
        <h2>بازی شروع شد</h2>
        <p>در حال پخش کارت‌ها…</p>
        <div className="start-overlay__bar"><span /></div>
      </div>
    </div>
  );
}

function Lobby({ room, me, isHost, toggleReady, addBot, removeBot, leaveRoom, invite, busy }: {
  room: RoomView;
  me: RoomPlayer | undefined;
  isHost: boolean;
  toggleReady: () => void;
  addBot: () => void;
  removeBot: (botId: string) => void;
  leaveRoom: () => void;
  invite: () => void;
  busy: boolean;
}) {
  const readiness = room.readiness;
  const seatsFull = room.players.length === 4;
  const waiting = readiness?.waitingOn.length ?? 0;

  return (
    <section className="panel lobby-panel">
      <h2>لابی میز</h2>
      <p>یارها روبه‌روی هم هستند: صندلی‌های ۱ و ۳ در برابر ۲ و ۴.</p>

      <div className="seat-grid">
        {[0, 1, 2, 3].map((seat) => {
          const player = room.players.find((p) => p.seat === seat);
          const offline = Boolean(player) && !player?.isBot && !player?.connected;
          const isMe = player?.id === me?.id;
          const host = Boolean(player) && player?.id === room.hostPlayerId;
          return (
            <div className={`seat-card ${offline ? 'offline' : ''} ${player?.ready ? 'ready' : ''}`} key={seat}>
              <span>
                صندلی {seat + 1}
                {host && <b className="host-tag">سازنده</b>}
              </span>
              <strong>
                {player ? `${player.name}${player.isBot ? ' 🤖' : ''}${isMe ? ' (تو)' : ''}` : 'در انتظار بازیکن...'}
              </strong>
              <div className="seat-footer">
                {player && !player.isBot && (
                  <em className={`seat-status ${player.ready ? 'is-ready' : ''}`}>
                    {player.ready ? 'آماده ✓' : offline ? 'قطع شده' : 'در انتظار آمادگی'}
                  </em>
                )}
                {player?.isBot && isHost && (
                  <button className="seat-remove" type="button" disabled={busy} onClick={() => removeBot(player.id)}>
                    حذف ربات
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ready-status">
        {!seatsFull
          ? `برای شروع به ۴ بازیکن نیاز داریم. الان ${room.players.length} نفر سر میز هستند.`
          : waiting > 0
            ? `منتظر آمادگی ${waiting} بازیکن هستیم.`
            : 'همه آماده‌اند! بازی در حال شروع است…'}
      </div>

      <button
        className={`ready-button ${me?.ready ? 'is-ready' : ''}`}
        type="button"
        disabled={busy}
        aria-pressed={Boolean(me?.ready)}
        onClick={toggleReady}
      >
        {me?.ready ? 'آماده‌ام ✓ (لغو)' : 'آماده بازی'}
      </button>

      <div className="row-actions">
        <button className="ghost" onClick={invite}>دعوت دوستان</button>
        <button className="ghost danger" type="button" disabled={busy} onClick={leaveRoom}>خروج از میز</button>
      </div>

      {isHost && !seatsFull && (
        <button className="test-bots-button" type="button" disabled={busy} onClick={addBot}>
          افزودن یک ربات 🤖
        </button>
      )}
      {!isHost && !seatsFull && (
        <p className="hint">فقط سازنده میز می‌تواند ربات اضافه یا حذف کند.</p>
      )}
    </section>
  );
}

function GameTable({ room, game, meId, chooseSuit, play, nextHand }: {
  room: RoomView; game: PublicGameView; meId: string; chooseSuit: (suit: Suit) => void; play: (card: Card) => void; nextHand: () => void;
}) {
  const me = room.players.find((p) => p.id === meId);
  const hakem = room.players.find((p) => p.seat === game.hakemSeat);
  const isMyTurn = me?.seat === game.currentTurnSeat;
  const isHakem = me?.seat === game.hakemSeat;

  return (
    <section className="table-wrap">
      <div className="score-strip">
        <Score title="تیم ۱" match={game.matchScore[0]} tricks={game.handScore.tricks[0]} />
        <div className="round-info"><span>راند {game.roundNumber}</span><strong>{game.trumpSuit ? suitSymbol(game.trumpSuit) : '؟'}</strong><small>حاکم: {hakem?.name}</small></div>
        <Score title="تیم ۲" match={game.matchScore[1]} tricks={game.handScore.tricks[1]} />
      </div>

      {game.phase === 'waiting_for_trump' && isHakem && (
        <div className="trump-picker glass">
          <h3 id="trump-title">حکم رو انتخاب کن</h3>
          <div role="group" aria-labelledby="trump-title">
            {suits.map((s) => (
              <button key={s.id} type="button" className={s.color} aria-label={`انتخاب حکم ${s.label}`} onClick={() => chooseSuit(s.id)}>
                <span aria-hidden="true">{s.symbol}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {game.phase === 'waiting_for_trump' && !isHakem && <div className="glass wait-card">منتظر انتخاب حکم توسط حاکم...</div>}

      <div className="table-center">
        <div className="turn-badge" role="status" aria-live="polite">
          {isMyTurn ? 'نوبت توئه' : `نوبت صندلی ${game.currentTurnSeat + 1}`}
        </div>
        <div className="played-cards">
          {game.currentTrick.plays.map((play) => <PlayingCard key={`${play.seat}-${play.card.id}`} card={play.card} compact />)}
        </div>
        <small>{game.lastEvent}</small>
      </div>

      {(game.phase === 'hand_complete' || game.phase === 'game_complete') && (
        <div className="glass result-card">
          <h2>{game.phase === 'game_complete' ? 'بازی تموم شد!' : 'راند تموم شد'}</h2>
          <p>{game.lastEvent}</p>
          {game.phase === 'hand_complete' && <button className="primary" onClick={nextHand}>راند بعدی</button>}
        </div>
      )}

      <div className="hand">
        {game.myHand.map((card) => <PlayingCard key={card.id} card={card} disabled={!game.validCardIds.includes(card.id)} onClick={() => play(card)} />)}
      </div>
    </section>
  );
}

function Score({ title, match, tricks }: { title: string; match: number; tricks: number }) {
  return <div className="score"><small>{title}</small><strong>{match}</strong><span>{tricks} دست</span></div>;
}

function PlayingCard({ card, disabled, compact, onClick }: { card: Card; disabled?: boolean; compact?: boolean; onClick?: () => void }) {
  const suit = suits.find((s) => s.id === card.suit)!;
  const label = `${card.rank} ${suit.label}`;
  return (
    <button
      type="button"
      className={`card ${suit.color} ${compact ? 'compact' : ''}`}
      disabled={disabled}
      aria-label={compact ? label : `بازی کردن ${label}`}
      title={label}
      onClick={onClick}
    >
      <span aria-hidden="true">{card.rank}</span>
      <b aria-hidden="true">{suit.symbol}</b>
    </button>
  );
}

function suitSymbol(suit: Suit) {
  return suits.find((s) => s.id === suit)?.symbol ?? '؟';
}

/** Only the fields the server expects; never leaks apiUrl into the payload. */
function socketPayload(session: StoredSession) {
  return {
    roomId: session.roomId,
    playerId: session.playerId,
    ...(session.token ? { token: session.token } : {}),
  };
}

class HokmRequestError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'HokmRequestError';
  }
}

/**
 * Only shows a server message when it is actually Persian; otherwise falls back
 * to our own Persian text so raw English codes never reach the player.
 */
function userMessage(payload: any, fallback: string): string {
  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  return message && /[\u0600-\u06FF]/.test(message) ? message : fallback;
}

function defaultApiUrl(): string {
  if (location.hostname === 'localhost' && location.port === '5173') {
    return 'http://localhost:4000';
  }
  return location.origin;
}

function resolveInitialApiUrl(): string {
  const params = new URLSearchParams(location.search);
  const apiFromUrl = params.get('api');
  if (apiFromUrl) {
    const normalized = normalizeApiUrl(apiFromUrl);
    localStorage.setItem('hokm.apiUrl', normalized);
    return normalized;
  }
  return normalizeApiUrl(localStorage.getItem('hokm.apiUrl') || DEFAULT_API_URL);
}

function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function parseJoinInput(input: string): { roomId: string; apiUrl?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { roomId: '' };
  try {
    const url = new URL(trimmed);
    const apiUrl = url.searchParams.get('api') ?? undefined;
    return { roomId: url.searchParams.get('room') ?? trimmed, ...(apiUrl ? { apiUrl } : {}) };
  } catch {
    return { roomId: trimmed };
  }
}

function saveSession(session: StoredSession) {
  localStorage.setItem('hokm.session', JSON.stringify(session));
  localStorage.setItem('hokm.apiUrl', session.apiUrl);
}
function clearSession() {
  localStorage.removeItem('hokm.session');
}
function readSession(apiUrl: string): StoredSession | null {
  try {
    const session = JSON.parse(localStorage.getItem('hokm.session') ?? 'null') as StoredSession | null;
    return session ? { ...session, apiUrl: session.apiUrl || apiUrl } : null;
  } catch {
    return null;
  }
}
function shareRoom(roomId: string, apiUrl: string) {
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}&api=${encodeURIComponent(apiUrl)}`;
  if (navigator.share) void navigator.share({ title: 'میز حکم', text: 'بیا حکم بازی کنیم', url: link });
  else void navigator.clipboard.writeText(link);
}

createRoot(document.getElementById('root')!).render(<App />);
