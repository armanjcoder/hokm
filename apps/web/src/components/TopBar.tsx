import { useEffect, useRef, useState } from 'react';
import { avatarUrl } from '../lib.js';
import { initialsFor } from '../table-seats.js';
import { CONNECTION_LABELS, type ConnectionStatus, type RoomPlayer, type RoomView } from '../types.js';
import { Avatar } from './Avatar.js';

export function TopBar({
  room,
  me,
  apiUrl,
  connection,
  showRules,
  showProfile,
  leaveRoom,
  leaveBusy = false,
}: {
  room: RoomView;
  me: RoomPlayer | undefined;
  apiUrl: string;
  connection: ConnectionStatus;
  showRules: () => void;
  /** Opens the player's own profile card. */
  showProfile: () => void;
  /** Omitted on screens where leaving is not possible. */
  leaveRoom?: (() => void) | undefined;
  leaveBusy?: boolean | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // A small popover anchored in the corner has to behave: Escape closes it and
  // clicking anywhere else dismisses it, otherwise it feels stuck.
  useEffect(() => {
    if (!confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setConfirming(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setConfirming(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [confirming]);

  return (
    <header className="topbar">
      <div>
        <strong>Hokm Club</strong>
        <small>میز {room.code}</small>
      </div>
      <div className="topbar-actions">
        {/* Always reachable, including mid-game when a beginner needs it most. */}
        <button className="help-button" type="button" aria-label="راهنمای قوانین" onClick={showRules}>
          ؟
        </button>
        {leaveRoom && (
          <div className="leave-menu">
            <button
              ref={triggerRef}
              className="icon-button icon-button--danger"
              type="button"
              aria-label="خروج از میز"
              aria-expanded={confirming}
              aria-haspopup="dialog"
              onClick={() => setConfirming((open) => !open)}
            >
              {/* Door with an outgoing arrow. Decorative: the label carries the meaning. */}
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 8 5 12l4 4M5 12h9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {confirming && (
              <div
                ref={popoverRef}
                className="leave-popover"
                role="dialog"
                aria-label="تأیید خروج از میز"
              >
                <p>
                  {room.status === 'playing'
                    ? 'وسط بازی بیرون بری، صندلی‌ات نگه داشته می‌شود و می‌توانی برگردی.'
                    : 'از این میز خارج می‌شوی.'}
                </p>
                <div className="leave-popover__actions">
                  <button
                    className="ghost danger"
                    type="button"
                    disabled={leaveBusy}
                    onClick={leaveRoom}
                  >
                    {leaveBusy ? 'در حال خروج…' : 'خروج'}
                  </button>
                  <button className="ghost" type="button" onClick={() => setConfirming(false)}>
                    ماندم
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <span className={`api-dot ${connection}`} title={`${CONNECTION_LABELS[connection]} — ${apiUrl}`} />
        {/* The player's own avatar is the profile entry point: it is already the
            thing that represents them everywhere else, so it needs no label of
            its own beyond the accessible name. */}
        <button
          className="profile-button"
          type="button"
          aria-label={me ? `پروفایل ${me.name}` : 'پروفایل من'}
          onClick={showProfile}
        >
          <Avatar
            initials={initialsFor(me?.name, me?.seat ?? 0)}
            tone="ours"
            size="sm"
            photoUrl={avatarUrl(apiUrl, room.id, me)}
          />
          <span className="profile-button__seat">{me ? `صندلی ${me.seat + 1}` : 'تماشاچی'}</span>
        </button>
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
