import type { GameMode } from '@hokm/game-engine';
import type { StoredSession } from '../lib.js';
import { MODE_OPTIONS, TARGET_SCORE_OPTIONS } from '../types.js';
import { isTelegramHost } from '../telegram.js';

export function Landing(props: {
  name: string; setName: (name: string) => void; joinCode: string; setJoinCode: (code: string) => void;
  apiUrl: string; setApiUrl: (url: string) => void; loading: boolean; createRoom: () => void; joinRoom: () => void; toast: string;
  savedSession: StoredSession | null; linkedRoomId: string; resumeSession: () => void; clearSavedSession: () => void;
  mode: GameMode; setMode: (mode: GameMode) => void; showRules: () => void;
  targetScore: number; setTargetScore: (score: number) => void;
}) {
  const linkPointsElsewhere = Boolean(props.linkedRoomId) && props.linkedRoomId !== props.savedSession?.roomId;
  const inTelegram = isTelegramHost();
  return (
    <main className="landing">
      {props.savedSession && (
        <section className="resume-card">
          <h2>میز قبلی‌ات باز است</h2>
          <p>
            {linkPointsElsewhere
              ? 'یک نشست ذخیره‌شده داری، ولی لینکی که باز کردی مربوط به میز دیگری است. انتخاب کن: به میز قبلی برگرد، یا نشست را پاک کن و با دکمه ورود به میز جدید برو.'
              : 'یک نشست ذخیره‌شده داری. می‌تونی به همان صندلی برگردی.'}
          </p>
          <span className="room-id-row">
            <small>کد میز</small>
            <code className="room-id">{props.savedSession.roomId}</code>
          </span>
          <div className="resume-actions">
            <button className="primary" type="button" onClick={props.resumeSession}>ادامه بازی</button>
            <button className="ghost" type="button" onClick={props.clearSavedSession}>میز جدید</button>
          </div>
        </section>
      )}
      <section className="hero-card">
        <div className="brand"><span>♠</span> Hokm Club</div>
        <h1>حکم، همین‌جا در تلگرام</h1>
        <p className="hero-lede">
          میز بساز، لینکش را برای دوستانت بفرست و شروع کن. نفر کم داشتی، ربات
          اضافه کن.
        </p>
        <label htmlFor="display-name">اسم نمایشی</label>
        <input
          id="display-name"
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          maxLength={40}
        />

        <label id="mode-label">حالت بازی</label>
        <div className="mode-picker" role="radiogroup" aria-labelledby="mode-label">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={props.mode === option.id}
              className={`mode-option ${props.mode === option.id ? 'is-active' : ''}`}
              onClick={() => props.setMode(option.id)}
            >
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
        <label id="target-label">بازی تا چند امتیاز؟</label>
        <div className="mode-picker score-picker" role="radiogroup" aria-labelledby="target-label">
          {TARGET_SCORE_OPTIONS.map((score) => (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={props.targetScore === score}
              className={`mode-option ${props.targetScore === score ? 'is-active' : ''}`}
              onClick={() => props.setTargetScore(score)}
            >
              <strong>{score}</strong>
            </button>
          ))}
        </div>

        <button className="link-button" type="button" onClick={props.showRules}>
          قوانین این حالت را بلد نیستم
        </button>
        {/* Only useful outside Telegram: inside the Mini App the bot link
            already carries the API address, so showing this to players would
            be noise they can only get wrong. */}
        {!inTelegram && (
          <details className="advanced-settings">
            <summary>تنظیم بک‌اند محلی</summary>
            <label htmlFor="api-url">آدرس HTTPS بک‌اند / Cloudflare Tunnel</label>
            <input
              id="api-url"
              dir="ltr"
              value={props.apiUrl}
              onChange={(e) => props.setApiUrl(e.target.value)}
              placeholder="https://your-api.trycloudflare.com"
            />
            <small>اگر از لینک بات وارد شوی، این مقدار خودکار تنظیم می‌شود.</small>
          </details>
        )}
        <div className="actions-grid">
          <button
            className="primary primary--hero"
            type="button"
            disabled={props.loading}
            onClick={props.createRoom}
          >
            {props.loading ? 'در حال ساخت…' : 'ساخت میز جدید'}
          </button>

          <div className="join-divider" role="separator">
            <span>یا با کد دوستت وارد شو</span>
          </div>

          <div className="join-box">
            <label className="sr-only" htmlFor="join-code">
              کد یا لینک میز
            </label>
            <input
              id="join-code"
              placeholder="کد یا لینک میز"
              value={props.joinCode}
              onChange={(e) => props.setJoinCode(e.target.value)}
            />
            <button type="button" onClick={props.joinRoom} disabled={props.loading}>
              ورود
            </button>
          </div>
        </div>
      </section>
      {props.toast && <div className="toast">{props.toast}</div>}
    </main>
  );
}
