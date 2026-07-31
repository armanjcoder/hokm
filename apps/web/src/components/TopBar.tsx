import { CONNECTION_LABELS, type ConnectionStatus, type RoomPlayer, type RoomView } from '../types.js';

export function TopBar({ room, me, apiUrl, connection, showRules }: {
  room: RoomView;
  me: RoomPlayer | undefined;
  apiUrl: string;
  connection: ConnectionStatus;
  showRules: () => void;
}) {
  return (
    <header className="topbar">
      <div><strong>Hokm Club</strong><small>میز {room.code}</small></div>
      <div className="topbar-actions">
        {/* Always reachable, including mid-game when a beginner needs it most. */}
        <button className="help-button" type="button" aria-label="راهنمای قوانین" onClick={showRules}>
          ؟
        </button>
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
