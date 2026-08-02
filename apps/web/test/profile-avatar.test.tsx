import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../src/components/Avatar.js';
import { GameTable } from '../src/components/GameTable.js';
import { Lobby } from '../src/components/Lobby.js';
import { ProfileSheet } from '../src/components/ProfileSheet.js';
import { TableScreen } from '../src/components/TableScreen.js';
import { TopBar } from '../src/components/TopBar.js';
import { avatarUrl } from '../src/lib.js';
import type { RoomView } from '../src/types.js';

afterEach(cleanup);

const noop = () => {};
const API = 'https://api.test';

/**
 * Phase 4.12 — Telegram profile photos.
 *
 * Structured deliberately as three layers, because past bugs in this project
 * survived tests that only exercised the leaf component: `PlayingCard` was
 * green while its wiring to `TableSeat` was broken. So each layer below is
 * asserted separately — the URL helper, the `Avatar` element, and then the real
 * screens rendering real trees, where the photo must actually reach the DOM.
 */

function player(over: Record<string, unknown> = {}) {
  return { id: 'p0', name: 'آرمان جعفری', seat: 0, connected: true, ...over } as any;
}

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    id: 'r1',
    code: 'ABCDE',
    status: 'lobby',
    mode: 'classic4',
    targetScore: 7,
    hostPlayerId: 'p0',
    players: [player({ hasPhoto: true, telegramId: 5 })],
    readiness: { waitingOn: [], humanCount: 1, botCount: 0, canStart: false },
    ...over,
  };
}

describe('avatarUrl', () => {
  it('points at our own API, never at the Telegram CDN', () => {
    const url = avatarUrl(API, 'r1', player({ hasPhoto: true }));
    expect(url).toBe('https://api.test/rooms/r1/players/p0/avatar');
    expect(url).not.toContain('telegram');
    expect(url).not.toContain('t.me');
  });

  it('returns nothing for a player without a public photo', () => {
    expect(avatarUrl(API, 'r1', player())).toBeUndefined();
  });

  it('returns nothing for bots, which have no Telegram account', () => {
    expect(avatarUrl(API, 'r1', player({ hasPhoto: true, isBot: true }))).toBeUndefined();
  });

  it('tolerates a missing player, room or origin instead of building a broken url', () => {
    expect(avatarUrl(API, 'r1', undefined)).toBeUndefined();
    expect(avatarUrl('', 'r1', player({ hasPhoto: true }))).toBeUndefined();
    expect(avatarUrl(API, '', player({ hasPhoto: true }))).toBeUndefined();
  });

  it('escapes ids so a crafted id cannot alter the path', () => {
    const url = avatarUrl(API, 'r/1', player({ id: '../../health', hasPhoto: true }));
    expect(url).toBe('https://api.test/rooms/r%2F1/players/..%2F..%2Fhealth/avatar');
  });

  it('normalises a trailing slash on the origin', () => {
    expect(avatarUrl('https://api.test/', 'r1', player({ hasPhoto: true }))).toBe(
      'https://api.test/rooms/r1/players/p0/avatar',
    );
  });
});

describe('Avatar photo rendering', () => {
  it('renders the photo over the initials, keeping both', () => {
    const { container } = render(<Avatar initials="آج" photoUrl="/photo.png" />);
    const img = container.querySelector('img.avatar__photo') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/photo.png');
    // The initials stay in the DOM underneath, so a failed load has something
    // to fall back to without any layout change.
    expect(container.textContent).toContain('آج');
  });

  it('falls back to initials when the image fails to load', () => {
    const { container } = render(<Avatar initials="آج" photoUrl="/broken.png" />);
    const img = container.querySelector('img.avatar__photo')!;
    fireEvent.error(img);
    expect(container.querySelector('img.avatar__photo')).toBeNull();
    expect(container.textContent).toContain('آج');
  });

  it('retries when the photo url changes after a failure', () => {
    const { container, rerender } = render(<Avatar initials="آج" photoUrl="/broken.png" />);
    fireEvent.error(container.querySelector('img.avatar__photo')!);
    expect(container.querySelector('img.avatar__photo')).toBeNull();

    rerender(<Avatar initials="آج" photoUrl="/other.png" />);
    expect(container.querySelector('img.avatar__photo')).not.toBeNull();
  });

  it('never shows a photo for a bot', () => {
    const { container } = render(<Avatar initials="آج" isBot photoUrl="/photo.png" />);
    expect(container.querySelector('img.avatar__photo')).toBeNull();
  });

  it('renders no image element at all when there is no photo', () => {
    const { container } = render(<Avatar initials="آج" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the photo decorative so screen readers hear the name, not "image"', () => {
    const { container } = render(<Avatar initials="آج" photoUrl="/photo.png" />);
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(container.querySelector('.avatar')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('loads lazily so a full table does not fire four blocking requests', () => {
    const { container } = render(<Avatar initials="آج" photoUrl="/photo.png" />);
    expect(container.querySelector('img')!.getAttribute('loading')).toBe('lazy');
  });
});

describe('wiring: the photo reaches real screens', () => {
  it('renders each lobby seat photo through the API origin', () => {
    const { container } = render(
      <Lobby
        room={room()}
        me={room().players[0]}
        isHost
        apiUrl={API}
        toggleReady={noop}
        addBot={noop}
        setBotDifficulty={noop}
        removeBot={noop}
        invite={noop}
        busy={false}
        showRules={noop}
        updateSettings={noop}
      />,
    );
    const img = container.querySelector('.seat-card img.avatar__photo') as HTMLImageElement;
    expect(img?.getAttribute('src')).toBe('https://api.test/rooms/r1/players/p0/avatar');
  });

  it('shows no photo in the lobby for a player without one', () => {
    const plain = room({ players: [player()] });
    const { container } = render(
      <Lobby
        room={plain}
        me={plain.players[0]}
        isHost
        apiUrl={API}
        toggleReady={noop}
        addBot={noop}
        setBotDifficulty={noop}
        removeBot={noop}
        invite={noop}
        busy={false}
        showRules={noop}
        updateSettings={noop}
      />,
    );
    expect(container.querySelector('.seat-card img.avatar__photo')).toBeNull();
  });

  it('renders the photo on the table seat, not only in the lobby', () => {
    // This is the exact wiring that broke silently before: a component that
    // works in isolation but is never handed the prop by its parent.
    const playing = room({
      status: 'playing',
      players: [0, 1, 2, 3].map((seat) =>
        player({ id: `p${seat}`, name: `بازیکن ${seat + 1}`, seat, hasPhoto: seat === 1 }),
      ),
    });
    const { container } = render(
      <GameTable
        room={playing}
        apiUrl={API}
        meId="p0"
        game={
          {
            id: 'g1',
            mode: 'classic4',
            phase: 'playing',
            hakemSeat: 0,
            currentTurnSeat: 0,
            trumpSuit: 'hearts',
            currentTrick: { leaderSeat: 0, plays: [] },
            completedTricks: [],
            handScore: { tricks: { 0: 0, 1: 0 } },
            matchScore: { 0: 0, 1: 0 },
            targetScore: 7,
            roundNumber: 1,
            players: [],
            myHand: [],
            validCardIds: [],
          } as any
        }
        chooseSuit={noop}
        play={noop}
        nextHand={noop}
        requestRedeal={noop}
        discard={noop}
        draw={noop}
        resolveDraw={noop}
      />,
    );

    const photos = Array.from(container.querySelectorAll('.table-seat img.avatar__photo'));
    expect(photos).toHaveLength(1);
    expect(photos[0]!.getAttribute('src')).toBe('https://api.test/rooms/r1/players/p1/avatar');
  });

  it('puts the player photo in the top bar profile button', () => {
    const { container } = render(
      <TopBar
        room={room()}
        me={player({ hasPhoto: true })}
        apiUrl={API}
        connection="connected"
        showRules={noop}
        showProfile={noop}
      />,
    );
    const button = screen.getByRole('button', { name: 'پروفایل آرمان جعفری' });
    expect(button.querySelector('img.avatar__photo')?.getAttribute('src')).toBe(
      'https://api.test/rooms/r1/players/p0/avatar',
    );
    expect(container.querySelector('.profile-button__seat')?.textContent).toBe('صندلی ۱'.replace('۱', '1'));
  });

  it('opens the profile sheet from the top bar and closes it again', async () => {
    render(
      <TableScreen
        room={room()}
        session={{ roomId: 'r1', playerId: 'p0', apiUrl: API }}
        me={player({ hasPhoto: true, telegramId: 5 })}
        game={undefined}
        apiUrl={API}
        connection="connected"
        toast=""
        starting={false}
        lobbyBusy={false}
        rulesOverlay={null}
        setToast={noop}
        showRules={noop}
        onNewTable={noop}
        lobby={{
          toggleReady: noop,
          addBot: noop,
          setBotDifficulty: noop,
          removeBot: noop,
          leaveRoom: noop,
          updateSettings: noop,
        }}
        table={{
          chooseSuit: noop,
          play: noop,
          nextHand: noop,
          requestRedeal: noop,
          discard: noop,
          draw: noop,
          resolveDraw: noop,
          hakemDrawDone: noop,
        }}
        invite={noop}
      />,
    );

    expect(screen.queryByRole('dialog', { name: /پروفایل|آرمان/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل آرمان جعفری' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('img.avatar__photo')?.getAttribute('src')).toBe(
      'https://api.test/rooms/r1/players/p0/avatar',
    );

    fireEvent.click(screen.getByRole('button', { name: 'بستن' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('ProfileSheet content', () => {
  function renderSheet(me: any, onClose = vi.fn()) {
    render(<ProfileSheet room={room()} me={me} apiUrl={API} onClose={onClose} />);
    return onClose;
  }

  it('names the player and their seat', () => {
    renderSheet(player({ hasPhoto: true, telegramId: 5 }));
    expect(screen.getByRole('heading', { name: 'آرمان جعفری' })).toBeTruthy();
    expect(screen.getByText('صندلی 1 این میز')).toBeTruthy();
  });

  it('explains that the photo is public when one is shown', () => {
    renderSheet(player({ hasPhoto: true, telegramId: 5 }));
    expect(screen.getByText(/عکس پروفایل تلگرامت عمومی است/)).toBeTruthy();
  });

  it('explains a missing photo for a Telegram user without blaming the app', () => {
    renderSheet(player({ telegramId: 5 }));
    expect(screen.getByText(/عمومی نیست یا اصلاً عکسی نداری/)).toBeTruthy();
  });

  it('explains that a guest simply has no Telegram identity', () => {
    renderSheet(player());
    expect(screen.getByText(/بدون تلگرام وارد شده‌ای/)).toBeTruthy();
    expect(screen.getByText('مهمان (بدون تلگرام)')).toBeTruthy();
  });

  it('is a modal dialog that traps focus and closes on Escape', () => {
    const onClose = renderSheet(player({ telegramId: 5 }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'بستن' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked but not when the sheet itself is', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ProfileSheet room={room()} me={player({ telegramId: 5 })} apiUrl={API} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('.rules-sheet')!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('.rules-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('survives a spectator with no seat at all', () => {
    renderSheet(undefined);
    expect(screen.getByRole('heading', { name: 'بازیکن مهمان' })).toBeTruthy();
    expect(screen.getByText('تماشاچی این میز')).toBeTruthy();
  });
});
