import { getModeConfig } from '@hokm/game-engine';
import {
  DIFFICULTY_OPTIONS,
  MODE_OPTIONS,
  TARGET_SCORE_OPTIONS,
  type BotDifficulty,
  type RoomPlayer,
  type RoomView,
} from '../types.js';

export function Lobby({ room, me, isHost, toggleReady, addBot, setBotDifficulty, removeBot, leaveRoom, invite, busy, showRules, updateSettings }: {
  room: RoomView;
  me: RoomPlayer | undefined;
  isHost: boolean;
  toggleReady: () => void;
  addBot: (difficulty: BotDifficulty) => void;
  setBotDifficulty: (botId: string, difficulty: BotDifficulty) => void;
  removeBot: (botId: string) => void;
  leaveRoom: () => void;
  invite: () => void;
  busy: boolean;
  showRules: () => void;
  updateSettings: (patch: {
    mode?: string;
    targetScore?: number;
    rules?: { lowHandRedeal?: boolean; bam?: boolean };
  }) => void;
}) {
  const readiness = room.readiness;
  const modeLabel = MODE_OPTIONS.find((option) => option.id === (room.mode ?? 'classic4'))?.label ?? '۴ نفره';
  // Seat count comes from the engine so the UI can never drift from the rules.
  const totalSeats = getModeConfig(room.mode).seats;
  const seatsFull = room.players.length === totalSeats;
  const waiting = readiness?.waitingOn.length ?? 0;

  return (
    <section className="panel lobby-panel">
      <h2>لابی میز — حکم {modeLabel}</h2>
      <p>
        {room.mode === 'classic4'
          ? 'یارها روبه‌روی هم هستند: صندلی‌های ۱ و ۳ در برابر ۲ و ۴.'
          : 'در این حالت هرکس برای خودش بازی می‌کند.'}
      </p>
      <button className="link-button" type="button" onClick={showRules}>
        قوانین حکم {modeLabel} را نشانم بده
      </button>

      {isHost && (
        <section className="table-settings">
          <h3>تنظیمات میز</h3>

          <span className="settings-label" id="lobby-mode-label">حالت بازی</span>
          <div className="mode-picker" role="radiogroup" aria-labelledby="lobby-mode-label">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={(room.mode ?? 'classic4') === option.id}
                disabled={busy}
                className={`mode-option ${(room.mode ?? 'classic4') === option.id ? 'is-active' : ''}`}
                onClick={() => updateSettings({ mode: option.id })}
              >
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>

          <span className="settings-label" id="lobby-score-label">بازی تا چند امتیاز؟</span>
          <div className="mode-picker score-picker" role="radiogroup" aria-labelledby="lobby-score-label">
            {TARGET_SCORE_OPTIONS.map((score) => (
              <button
                key={score}
                type="button"
                role="radio"
                aria-checked={(room.targetScore ?? 7) === score}
                disabled={busy}
                className={`mode-option ${(room.targetScore ?? 7) === score ? 'is-active' : ''}`}
                onClick={() => updateSettings({ targetScore: score })}
              >
                <strong>{score}</strong>
              </button>
            ))}
          </div>
          <label className="rule-toggle">
            <input
              type="checkbox"
              disabled={busy}
              checked={Boolean(room.rules?.lowHandRedeal)}
              onChange={(event) => updateSettings({ rules: { lowHandRedeal: event.target.checked } })}
            />
            <span>
              <strong>ده‌لو کم</strong>
              <small>اگر ۵ کارت اول حاکم هیچ کارت عکس‌داری نداشت، می‌تواند بخواهد دوباره پخش شود.</small>
            </span>
          </label>

          <label className="rule-toggle">
            <input
              type="checkbox"
              disabled={busy}
              checked={Boolean(room.rules?.bam)}
              onChange={(event) => updateSettings({ rules: { bam: event.target.checked } })}
            />
            <span>
              <strong>بام</strong>
              <small>بازی بعد از ۷ دست ادامه پیدا می‌کند؛ هرکس همه دست‌ها را ببرد، کل بازی را برده.</small>
            </span>
          </label>

          <small className="settings-hint">با تغییر حالت بازی، آمادگی همه دوباره صفر می‌شود.</small>
        </section>
      )}
      {!isHost && (
        <p className="hint">
          بازی تا {room.targetScore ?? 7} امتیاز. فقط سازنده میز می‌تواند تنظیمات را عوض کند.
        </p>
      )}

      <div className="seat-grid">
        {Array.from({ length: totalSeats }, (_, seat) => seat).map((seat) => {
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
                  <div className="bot-controls">
                    <select
                      className="bot-difficulty"
                      aria-label={`سطح سختی ${player.name}`}
                      value={player.difficulty ?? 'medium'}
                      disabled={busy}
                      onChange={(event) =>
                        setBotDifficulty(player.id, event.target.value as BotDifficulty)
                      }
                    >
                      {DIFFICULTY_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button className="seat-remove" type="button" disabled={busy} onClick={() => removeBot(player.id)}>
                      حذف
                    </button>
                  </div>
                )}
                {player?.isBot && !isHost && (
                  <em className="seat-status">
                    {DIFFICULTY_OPTIONS.find((o) => o.id === (player.difficulty ?? 'medium'))?.label}
                  </em>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ready-status">
        {!seatsFull
          ? `برای شروع به ${totalSeats} بازیکن نیاز داریم. الان ${room.players.length} نفر سر میز هستند.`
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
        <button className="ghost" type="button" onClick={invite}>دعوت دوستان</button>
        <button className="ghost danger" type="button" disabled={busy} onClick={leaveRoom}>خروج از میز</button>
      </div>

      {isHost && !seatsFull && (
        <div className="add-bot-row">
          <span className="settings-label">افزودن ربات با سطح:</span>
          <div className="add-bot-buttons">
            {DIFFICULTY_OPTIONS.map((option) => (
              <button
                key={option.id}
                className="test-bots-button"
                type="button"
                disabled={busy}
                onClick={() => addBot(option.id)}
              >
                {option.label} 🤖
              </button>
            ))}
          </div>
        </div>
      )}
      {!isHost && !seatsFull && (
        <p className="hint">فقط سازنده میز می‌تواند ربات اضافه یا حذف کند.</p>
      )}
    </section>
  );
}
