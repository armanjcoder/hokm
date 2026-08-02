import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Can the player actually GET to their profile?
 *
 * This file exists because of a real bug: the profile sheet, the button, the
 * styles and the endpoint were all written, tested and shipped — and the
 * feature was still invisible, because the only entry point lived in `TopBar`,
 * which renders solely after a table has been joined. Every existing test
 * rendered `TopBar` or `TableScreen` directly and so proved nothing about
 * reachability.
 *
 * The rule these tests encode: mount the app the way a player meets it, from
 * `App`, and click only what is actually on screen.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
  // No auto-join: the landing screen must be what renders.
  window.history.replaceState({}, '', '/');
});

async function renderApp() {
  vi.resetModules();
  const { App } = await import('../src/App.js');
  return render(<App />);
}

describe('profile is reachable on the very first screen', () => {
  it('shows a profile control before any table exists', async () => {
    await renderApp();
    // The landing screen is what an opening player sees. If the profile is not
    // here, it does not exist for them.
    expect(screen.getByRole('button', { name: 'پروفایل من' })).toBeTruthy();
  });

  it('opens the profile sheet from the landing screen', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('profile-sheet');
  });

  it('closes again, so the player is not trapped', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'بستن' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says honestly that no table has been joined yet', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));
    await screen.findByRole('dialog');
    expect(screen.getByText('هنوز سر هیچ میزی ننشسته‌ای')).toBeTruthy();
  });

  it('uses the name the player typed, not a placeholder', async () => {
    await renderApp();
    const input = screen.getByLabelText('اسم نمایشی');
    fireEvent.change(input, { target: { value: 'آرمان جعفری' } });

    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { name: 'آرمان جعفری' })).toBeTruthy();
  });
});

describe('profile inside Telegram loads the photo without a room', () => {
  function stubTelegram(initData: string) {
    vi.stubGlobal('Telegram', {
      WebApp: {
        initData,
        initDataUnsafe: { user: { id: 5, first_name: 'آرمان' } },
        version: '7.10',
        ready() {},
        expand() {},
      },
    });
  }

  it('asks our own API for the photo, not the Telegram CDN', async () => {
    stubTelegram('user=%7B%22id%22%3A5%7D&hash=abc');
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));
    const dialog = await screen.findByRole('dialog');

    const img = dialog.querySelector('img.avatar__photo') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain('/me/avatar');
    expect(img.src).not.toContain('t.me');
    expect(img.src).not.toContain('telegram.org');
  });

  it('passes the signed initData so the server can identify the caller', async () => {
    stubTelegram('user=%7B%22id%22%3A5%7D&hash=abc');
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));
    const dialog = await screen.findByRole('dialog');

    const img = dialog.querySelector('img.avatar__photo') as HTMLImageElement;
    expect(decodeURIComponent(img.src)).toContain('hash=abc');
  });

  it('reports a Telegram login rather than calling the player a guest', async () => {
    stubTelegram('user=%7B%22id%22%3A5%7D&hash=abc');
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));
    await screen.findByRole('dialog');
    expect(screen.getByText('با حساب تلگرام')).toBeTruthy();
  });

  it('renders no photo request at all outside Telegram', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'پروفایل من' }));
    const dialog = await screen.findByRole('dialog');
    // No initData means nothing to authenticate with, so no pointless request.
    expect(dialog.querySelector('img.avatar__photo')).toBeNull();
    expect(screen.getByText('مهمان (بدون تلگرام)')).toBeTruthy();
  });
});
