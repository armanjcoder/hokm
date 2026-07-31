import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbandonedNotice } from '../src/components/AbandonedNotice.js';
import { Landing } from '../src/components/Landing.js';
import { PlayingCard } from '../src/components/PlayingCard.js';
import { ResumingScreen } from '../src/components/ResumingScreen.js';
import { StartOverlay } from '../src/components/StartOverlay.js';
import { Toast } from '../src/components/Toast.js';

afterEach(cleanup);

const noop = () => {};

describe('PlayingCard', () => {
  const card = { id: 'hearts-A', suit: 'hearts', rank: 'A' } as const;

  it('announces the card in Persian for screen readers', () => {
    render(<PlayingCard card={card} onClick={noop} />);
    expect(screen.getByLabelText('بازی کردن A دل')).toBeDefined();
  });

  it('is not clickable when disabled', () => {
    const onClick = vi.fn();
    render(<PlayingCard card={card} disabled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks a selected card for assistive tech', () => {
    render(<PlayingCard card={card} selected onClick={noop} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the right colour class per suit', () => {
    const { container } = render(<PlayingCard card={card} onClick={noop} />);
    expect(container.querySelector('.card.red')).not.toBeNull();
    cleanup();
    const black = render(
      <PlayingCard card={{ id: 'spades-2', suit: 'spades', rank: '2' }} onClick={noop} />,
    );
    expect(black.container.querySelector('.card.black')).not.toBeNull();
  });
});

describe('Toast', () => {
  it('is announced as an alert and dismisses on click', () => {
    const onDismiss = vi.fn();
    render(<Toast message="خطایی رخ داد" onDismiss={onDismiss} />);
    expect(screen.getByRole('alert').textContent).toBe('خطایی رخ داد');
    fireEvent.click(screen.getByRole('alert'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('AbandonedNotice', () => {
  it('offers a way out of a dead table', () => {
    const onNewTable = vi.fn();
    render(<AbandonedNotice onNewTable={onNewTable} />);
    fireEvent.click(screen.getByText('ساخت میز جدید'));
    expect(onNewTable).toHaveBeenCalledTimes(1);
  });
});

describe('StartOverlay', () => {
  it('is a polite status region so it does not interrupt', () => {
    render(<StartOverlay />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('بازی شروع شد');
  });
});

describe('ResumingScreen', () => {
  it('always offers an escape route so the player cannot get stuck', () => {
    const cancel = vi.fn();
    const forget = vi.fn();
    render(<ResumingScreen roomId="abc123" connection="offline" cancel={cancel} forget={forget} />);

    fireEvent.click(screen.getByText('لغو و برگشت به صفحه اول'));
    expect(cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('پاک کردن نشست و ساخت میز جدید'));
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('explains that the backend may be off when disconnected', () => {
    render(<ResumingScreen roomId="abc" connection="offline" cancel={noop} forget={noop} />);
    expect(screen.getByText(/بک‌اند خاموش است/)).toBeDefined();
  });

  it('shows the room id so the player knows which table', () => {
    render(<ResumingScreen roomId="tbl-42" connection="connected" cancel={noop} forget={noop} />);
    expect(screen.getByText('tbl-42')).toBeDefined();
  });
});

describe('Landing', () => {
  function renderLanding(overrides = {}) {
    const props = {
      name: 'آرمان',
      setName: noop,
      joinCode: '',
      setJoinCode: noop,
      apiUrl: 'https://x',
      setApiUrl: noop,
      loading: false,
      createRoom: noop,
      joinRoom: noop,
      toast: '',
      savedSession: null,
      linkedRoomId: '',
      resumeSession: noop,
      clearSavedSession: noop,
      mode: 'classic4' as const,
      setMode: noop,
      showRules: noop,
      targetScore: 7,
      setTargetScore: noop,
      ...overrides,
    };
    return render(<Landing {...(props as any)} />);
  }

  it('disables both actions while a request is in flight', () => {
    renderLanding({ loading: true });
    expect((screen.getByText('ساخت میز جدید') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('ورود') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the resume card when there is no saved session', () => {
    renderLanding();
    expect(screen.queryByText('ادامه بازی')).toBeNull();
  });

  it('offers to resume a saved table', () => {
    const resumeSession = vi.fn();
    renderLanding({
      savedSession: { roomId: 'r1', playerId: 'p1', apiUrl: 'https://x' },
      resumeSession,
    });
    fireEvent.click(screen.getByText('ادامه بازی'));
    expect(resumeSession).toHaveBeenCalledTimes(1);
  });

  it('warns when the opened link points at a different table', () => {
    renderLanding({
      savedSession: { roomId: 'r1', playerId: 'p1', apiUrl: 'https://x' },
      linkedRoomId: 'r2',
    });
    expect(screen.getByText(/مربوط به میز دیگری است/)).toBeDefined();
  });

  it('does not warn when the link matches the saved table', () => {
    renderLanding({
      savedSession: { roomId: 'r1', playerId: 'p1', apiUrl: 'https://x' },
      linkedRoomId: 'r1',
    });
    expect(screen.queryByText(/مربوط به میز دیگری است/)).toBeNull();
  });
});
