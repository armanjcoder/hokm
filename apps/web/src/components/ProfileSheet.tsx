import { useRef } from 'react';
import { avatarUrl, myAvatarUrl } from '../lib.js';
import { initialsFor } from '../table-seats.js';
import { useFocusTrap } from '../useFocusTrap.js';
import type { RoomPlayer, RoomView } from '../types.js';
import { Avatar } from './Avatar.js';

/**
 * The player's own profile card.
 *
 * Everything here comes from the server, which only trusts the signed Telegram
 * `initData` — so what a player sees is what other seats see, not something the
 * client made up. The photo is the point of this sheet: it is the one place a
 * player can check that the game picked up their Telegram identity correctly,
 * including the honest answer when it did not.
 *
 * Stats (wins, kots, streaks) belong to a later phase; promising them here with
 * empty placeholders would be worse than not showing them.
 */
export function ProfileSheet({
  room,
  me,
  apiUrl,
  onClose,
  /** Signed Telegram data, used to load the photo when there is no table yet. */
  initData = '',
  /** Name to show before the player has a seat. */
  fallbackName,
  /** True when Telegram identified the viewer but no room has been joined. */
  telegramUser = false,
}: {
  /** Omitted on the landing screen, where no table exists. */
  room?: RoomView | undefined;
  me: RoomPlayer | undefined;
  apiUrl: string;
  onClose: () => void;
  initData?: string;
  fallbackName?: string | undefined;
  telegramUser?: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap({ containerRef: sheetRef, onClose, initialFocusRef: closeRef });

  // At a table the photo is proxied per seat; before that there is no seat, so
  // the server identifies the viewer from their signed Telegram data instead.
  const photo = room && me ? avatarUrl(apiUrl, room.id, me) : myAvatarUrl(apiUrl, initData);
  const isTelegram = me ? me.telegramId !== undefined : telegramUser;
  const displayName = me?.name ?? fallbackName ?? 'بازیکن مهمان';

  // Says exactly which of the three states the player is in, because "no photo"
  // has three different causes and only one of them is worth acting on.
  const photoNote = !isTelegram
    ? 'چون بدون تلگرام وارد شده‌ای، عکس پروفایل نداریم و همان حروف اول اسمت نمایش داده می‌شود.'
    : photo
      ? 'عکس پروفایل تلگرامت عمومی است و روی میز هم همین را می‌بینند.'
      : 'عکس پروفایل تلگرامت عمومی نیست یا اصلاً عکسی نداری، پس حروف اول اسمت نمایش داده می‌شود.';

  return (
    // Same backdrop and sheet shell as the rules guide, so a second modal does
    // not introduce a second visual language.
    <div className="rules-backdrop" role="presentation" onClick={onClose}>
      <div
        className="rules-sheet profile-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        ref={sheetRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="profile-sheet__head">
          <Avatar
            initials={initialsFor(displayName, me?.seat ?? 0)}
            tone="ours"
            size="lg"
            photoUrl={photo}
          />
          <div className="profile-sheet__identity">
            <h2 id="profile-title">{displayName}</h2>
            <p className="profile-sheet__role">
              {me
                ? `صندلی ${me.seat + 1} این میز`
                : room
                  ? 'تماشاچی این میز'
                  : 'هنوز سر هیچ میزی ننشسته‌ای'}
            </p>
          </div>
        </div>

        <dl className="profile-sheet__facts">
          <div>
            <dt>ورود</dt>
            <dd>{isTelegram ? 'با حساب تلگرام' : 'مهمان (بدون تلگرام)'}</dd>
          </div>
          <div>
            <dt>میز فعلی</dt>
            <dd>{room ? room.code : '—'}</dd>
          </div>
        </dl>

        <p className="profile-sheet__note">{photoNote}</p>

        <button className="primary full-width" type="button" ref={closeRef} onClick={onClose}>
          بستن
        </button>
      </div>
    </div>
  );
}
