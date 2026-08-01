import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrumpSheet } from '../src/components/TrumpSheet.js';

afterEach(cleanup);

/**
 * The trump sheet.
 *
 * Naming trump blocks the hand, so this surface is modal and has no dismiss.
 * That makes its keyboard behaviour load-bearing: a keyboard user who cannot
 * reach the suits has no way to continue the game at all.
 */

describe('choosing a suit', () => {
  it('offers all four suits', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    for (const label of ['پیک', 'دل', 'خشت', 'گشنیز']) {
      expect(screen.getByRole('button', { name: `انتخاب حکم ${label}` })).toBeDefined();
    }
  });

  it('reports the chosen suit', () => {
    const onChoose = vi.fn();
    render(<TrumpSheet onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: 'انتخاب حکم دل' }));
    expect(onChoose).toHaveBeenCalledWith('hearts');
  });

  it('labels each suit for assistive tech, not just with a symbol', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    const spades = screen.getByRole('button', { name: 'انتخاب حکم پیک' });
    // The glyph itself is decorative; the name carries the meaning.
    expect(spades.querySelector('[aria-hidden="true"]')?.textContent).toBe('♠');
  });
});

describe('sheet behaviour', () => {
  it('is a modal dialog', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('focuses the first suit when it opens', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'انتخاب حکم پیک' }));
  });

  it('keeps Tab inside the sheet', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    const last = screen.getByRole('button', { name: 'انتخاب حکم گشنیز' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'انتخاب حکم پیک' }));
  });

  it('cycles backwards with Shift+Tab', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    const first = screen.getByRole('button', { name: 'انتخاب حکم پیک' });
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'انتخاب حکم گشنیز' }));
  });

  it('cannot be dismissed, because the hand cannot continue without a trump', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    // Escape must not tear the sheet down and strand the table.
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});

describe('the low hand redeal', () => {
  it('is hidden when the hand does not qualify', () => {
    render(<TrumpSheet onChoose={() => {}} />);
    expect(screen.queryByRole('button', { name: /ده‌لو کم/ })).toBeNull();
  });

  it('is offered inside the sheet when it does', () => {
    render(<TrumpSheet onChoose={() => {}} canRequestRedeal onRequestRedeal={() => {}} />);
    expect(screen.getByRole('button', { name: 'ده‌لو کم دارم؛ دوباره پخش کن' })).toBeDefined();
  });

  it('reports the request', () => {
    const onRequestRedeal = vi.fn();
    render(<TrumpSheet onChoose={() => {}} canRequestRedeal onRequestRedeal={onRequestRedeal} />);
    fireEvent.click(screen.getByRole('button', { name: 'ده‌لو کم دارم؛ دوباره پخش کن' }));
    expect(onRequestRedeal).toHaveBeenCalledOnce();
  });

  it('stays hidden without a handler, so it can never be a dead button', () => {
    render(<TrumpSheet onChoose={() => {}} canRequestRedeal />);
    expect(screen.queryByRole('button', { name: /ده‌لو کم/ })).toBeNull();
  });

  it('is reachable by keyboard along with the suits', () => {
    render(<TrumpSheet onChoose={() => {}} canRequestRedeal onRequestRedeal={() => {}} />);
    const redeal = screen.getByRole('button', { name: 'ده‌لو کم دارم؛ دوباره پخش کن' });
    redeal.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // It is the last control, so Tab wraps back to the first suit.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'انتخاب حکم پیک' }));
  });
});
