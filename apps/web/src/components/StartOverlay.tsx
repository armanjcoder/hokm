import { SUIT_META } from '../types.js';

export function StartOverlay() {
  return (
    <div className="start-overlay" role="status" aria-live="polite">
      <div className="start-overlay__card">
        <div className="start-overlay__suits">
          {SUIT_META.map((suit, index) => (
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
