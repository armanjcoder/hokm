import type { ConnectionStatus } from '../types.js';

export function ResumingScreen({ roomId, connection, cancel, forget }: {
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
