import type { StoredSession } from '../lib.js';

export function Landing(props: {
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
