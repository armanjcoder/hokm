import type { RoomPlayer, RoomView } from '../types.js';

export function Lobby({ room, me, isHost, toggleReady, addBot, removeBot, leaveRoom, invite, busy }: {
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
