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
  it('marks exactly one mode as selected', () => {
    render(<App />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);

    fireEvent.click(screen.getByText('۳ نفره'));
    const after = screen.getAllByRole('radio');
    expect(after.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });

  it('defaults to the four player game', () => {
    render(<App />);
    const selected = screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true');
    expect(selected?.textContent).toContain('۴ نفره');
  });
});
