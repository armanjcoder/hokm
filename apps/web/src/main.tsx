import React, { useEffect, useMemo, useState } from 'react';
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
        initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
      };
    };
  }
}

type RoomStatus = 'lobby' | 'playing' | 'finished';
interface RoomPlayer { id: string; name: string; telegramId?: number; seat: number; connected: boolean; isBot?: boolean }
interface RoomView {
  id: string;
  code: string;
  status: RoomStatus;
  players: RoomPlayer[];
  game?: PublicGameView;
}
interface StoredSession { roomId: string; playerId: string; apiUrl: string }

function App() {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const defaultName = tgUser?.first_name || tgUser?.username || 'بازیکن حکم';
  const initialApiUrl = resolveInitialApiUrl();
  const [apiUrl, setApiUrlState] = useState(initialApiUrl);
  const [name, setName] = useState(defaultName);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [session, setSession] = useState<StoredSession | null>(() => readSession(initialApiUrl));
  const [joinCode, setJoinCode] = useState(new URLSearchParams(location.search).get('room') ?? '');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const socket = useMemo<Socket>(() => io(apiUrl, { autoConnect: false }), [apiUrl]);
  const me = room?.players.find((p) => p.id === session?.playerId);
  const game = room?.game;

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  useEffect(() => {
    if (!session) return;
    socket.connect();
    socket.emit('room:join', session, (response: any) => {
      if (response?.ok && response.room) {
        setRoom(response.room);
        return;
      }
      if (response?.ok === false) {
        if (response.error === 'ROOM_NOT_FOUND') {
          clearSession();
          setSession(null);
          setRoom(null);
          setJoinCode('');
          setToast('میز قبلی پیدا نشد؛ احتمالاً قبل از فعال شدن ذخیره‌سازی ساخته شده یا دیتابیس پاک شده. یک میز جدید بساز.');
          return;
        }
        setToast('ارتباط با میز برقرار نشد. بک‌اند را روشن و آدرس API را چک کن.');
      }
    });
    socket.on('room:update', (nextRoom: RoomView) => setRoom(nextRoom));
    return () => {
      socket.off('room:update');
      socket.disconnect();
    };
  }, [session, socket]);

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
        body: JSON.stringify({ hostName: name, telegramId: tgUser?.id }),
      });
      const nextRoom = await response.json();
      if (!response.ok) throw new Error(nextRoom.error ?? 'CREATE_FAILED');
      const player = nextRoom.players[0];
      const nextSession = { roomId: nextRoom.id, playerId: player.id, apiUrl };
      saveSession(nextSession);
      setSession(nextSession);
      setRoom(nextRoom);
      setToast('میز ساخته شد؛ کد یا لینک رو برای دوستات بفرست.');
    } catch (error) {
      setToast('ساخت میز انجام نشد. بک‌اند یا آدرس API را چک کن.');
    } finally {
      setLoading(false);
    }
  }

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
        body: JSON.stringify({ name, telegramId: tgUser?.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'JOIN_FAILED');
      const nextSession = { roomId: data.room.id, playerId: data.player.id, apiUrl: targetApiUrl };
      saveSession(nextSession);
      setSession(nextSession);
      setRoom(data.room);
    } catch (error) {
      setToast('اتصال به میز انجام نشد. لینک میز یا آدرس API رو چک کن.');
    } finally {
      setLoading(false);
    }
  }

  async function startGame() {
    if (!room) return;
    const response = await fetch(`${apiUrl}/rooms/${room.id}/start`, { method: 'POST' });
    if (!response.ok) setToast('برای شروع باید هر ۴ بازیکن داخل میز باشند.');
  }

  async function addTestBots() {
    if (!room) return;
    const response = await fetch(`${apiUrl}/rooms/${room.id}/add-bots`, { method: 'POST' });
    if (!response.ok) setToast('اضافه کردن ربات‌های تست انجام نشد.');
  }

  function chooseSuit(suit: Suit) {
    if (!session) return;
    socket.emit('game:choose_trump', { ...session, suit }, ackToast);
  }

  function play(card: Card) {
    if (!session || !game?.validCardIds.includes(card.id)) return;
    socket.emit('game:play_card', { ...session, cardId: card.id }, ackToast);
  }

  function nextHand() {
    if (!session) return;
    socket.emit('game:next_hand', { roomId: session.roomId }, ackToast);
  }

  function ackToast(response: any) {
    if (response?.ok === false) setToast(response.message ?? response.error ?? 'حرکت نامعتبر بود.');
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
        clearSavedSession={() => { clearSession(); setSession(null); setRoom(null); setToast('نشست قبلی پاک شد. حالا می‌تونی میز جدید بسازی.'); }}
      />
    );
  }

  return (
    <main className="app-shell">
      <TopBar room={room} me={me} apiUrl={apiUrl} />
      {room.status === 'lobby' && <Lobby room={room} startGame={startGame} addTestBots={addTestBots} invite={() => shareRoom(room.id, apiUrl)} />}
      {room.status !== 'lobby' && game && (
        <GameTable
          room={room}
          game={game}
          meId={session.playerId}
          chooseSuit={chooseSuit}
          play={play}
          nextHand={nextHand}
        />
      )}
      {toast && <button className="toast" onClick={() => setToast('')}>{toast}</button>}
    </main>
  );
}

function Landing(props: {
  name: string; setName: (name: string) => void; joinCode: string; setJoinCode: (code: string) => void;
  apiUrl: string; setApiUrl: (url: string) => void; loading: boolean; createRoom: () => void; joinRoom: () => void; toast: string; clearSavedSession: () => void;
}) {
  return (
    <main className="landing">
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
          <button className="ghost full-width" type="button" onClick={props.clearSavedSession}>پاک کردن نشست قبلی</button>
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

function TopBar({ room, me, apiUrl }: { room: RoomView; me: RoomPlayer | undefined; apiUrl: string }) {
  return (
    <header className="topbar">
      <div><strong>Hokm Club</strong><small>میز {room.code}</small></div>
      <div className="topbar-actions"><span className="api-dot" title={apiUrl} /><div className="pill">{me ? `صندلی ${me.seat + 1}` : 'تماشاچی'}</div></div>
    </header>
  );
}

function Lobby({ room, startGame, addTestBots, invite }: { room: RoomView; startGame: () => void; addTestBots: () => void; invite: () => void }) {
  return (
    <section className="panel lobby-panel">
      <h2>لابی میز</h2>
      <p>یارها روبه‌روی هم هستند: صندلی‌های ۱ و ۳ در برابر ۲ و ۴.</p>
      <div className="seat-grid">
        {[0, 1, 2, 3].map((seat) => {
          const player = room.players.find((p) => p.seat === seat);
          return <div className="seat-card" key={seat}><span>صندلی {seat + 1}</span><strong>{player ? `${player.name}${player.isBot ? ' 🤖' : ''}` : 'در انتظار بازیکن...'}</strong></div>;
        })}
      </div>
      <div className="row-actions">
        <button className="primary" onClick={startGame}>شروع بازی</button>
        <button className="ghost" onClick={invite}>دعوت دوستان</button>
      </div>
      {room.players.length < 4 && (
        <button className="test-bots-button" onClick={addTestBots}>تست تک‌نفره: اضافه کردن ربات‌ها 🤖</button>
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
        <div className="trump-picker glass"><h3>حکم رو انتخاب کن</h3><div>{suits.map((s) => <button key={s.id} className={s.color} onClick={() => chooseSuit(s.id)}>{s.symbol}<span>{s.label}</span></button>)}</div></div>
      )}
      {game.phase === 'waiting_for_trump' && !isHakem && <div className="glass wait-card">منتظر انتخاب حکم توسط حاکم...</div>}

      <div className="table-center">
        <div className="turn-badge">{isMyTurn ? 'نوبت توئه' : `نوبت صندلی ${game.currentTurnSeat + 1}`}</div>
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
  return <button className={`card ${suit.color} ${compact ? 'compact' : ''}`} disabled={disabled} onClick={onClick}><span>{card.rank}</span><b>{suit.symbol}</b></button>;
}

function suitSymbol(suit: Suit) {
  return suits.find((s) => s.id === suit)?.symbol ?? '؟';
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
