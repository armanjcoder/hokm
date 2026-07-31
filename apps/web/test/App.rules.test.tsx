import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The socket is irrelevant to these tests; stub it so App can mount offline.
vi.mock('../src/api/socket.js', () => ({
  createGameSocket: () => ({
    connected: false,
    on() {},
    off() {},
    emit() {},
    connect() {},
    disconnect() {},
    close() {},
    io: { on() {}, off() {} },
  }),
}));

import { App } from '../src/App.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe('rules guide availability', () => {
  it('opens from the landing screen before any room exists', () => {
    render(<App />);
    // Regression guard: the guide used to be unreachable here because the
    // landing screen returned early, before the overlay was rendered.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByText('قوانین این حالت را بلد نیستم'));

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('حکم ۴ نفره')).toBeDefined();
  });

  it('shows the guide for whichever mode is selected', () => {
    render(<App />);

    fireEvent.click(screen.getByText('۲ نفره'));
    fireEvent.click(screen.getByText('قوانین این حالت را بلد نیستم'));
    expect(screen.getByText('حکم ۲ نفره')).toBeDefined();

    fireEvent.click(screen.getByText('فهمیدم'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByText('۳ نفره'));
    fireEvent.click(screen.getByText('قوانین این حالت را بلد نیستم'));
    expect(screen.getByText('حکم ۳ نفره')).toBeDefined();
  });

  it('closes again from the landing screen', () => {
    render(<App />);
    fireEvent.click(screen.getByText('قوانین این حالت را بلد نیستم'));
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByText('فهمیدم'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('mode picker', () => {
  /** The landing page has two radio groups: game mode and target score. */
  const modeRadios = () =>
    screen.getAllByRole('radio').filter((r) => /نفره/.test(r.textContent ?? ''));

  it('marks exactly one mode as selected', () => {
    render(<App />);
    expect(modeRadios()).toHaveLength(3);
    expect(modeRadios().filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);

    fireEvent.click(screen.getByText('۳ نفره'));
    expect(modeRadios().filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });

  it('defaults to the four player game', () => {
    render(<App />);
    const selected = modeRadios().find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected?.textContent).toContain('۴ نفره');
  });
});

describe('target score picker', () => {
  const scoreRadios = () =>
    screen.getAllByRole('radio').filter((r) => /^(۳|3|5|7|11)$/.test((r.textContent ?? '').trim()));

  it('offers 3, 5, 7 and 11 and defaults to 7', () => {
    render(<App />);
    const scores = scoreRadios();
    expect(scores.map((r) => r.textContent?.trim())).toEqual(['3', '5', '7', '11']);
    const selected = scores.find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected?.textContent?.trim()).toBe('7');
  });

  it('lets the host pick a shorter match', () => {
    render(<App />);
    fireEvent.click(screen.getByText('5'));
    const selected = scoreRadios().find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected?.textContent?.trim()).toBe('5');
  });
});
