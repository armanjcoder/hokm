import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from '../src/useFocusTrap.js';

afterEach(cleanup);

/**
 * Shared modal keyboard behaviour.
 *
 * Every dialog in the app depends on this, so the edge cases live here once
 * rather than being reimplemented, and subtly differently, in each sheet.
 */

function Trapped({
  onClose,
  active = true,
  disabledFirst = false,
}: {
  onClose?: () => void;
  active?: boolean;
  disabledFirst?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useFocusTrap({ containerRef: container, onClose, active });
  return (
    <div ref={container}>
      <button type="button" disabled={disabledFirst}>
        اول
      </button>
      <button type="button">دوم</button>
      <button type="button">سوم</button>
    </div>
  );
}

const byText = (text: string) => document.querySelector(`button:not([disabled])`) && [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;

describe('useFocusTrap', () => {
  it('focuses the first control when it opens', () => {
    render(<Trapped />);
    expect(document.activeElement).toBe(byText('اول'));
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Trapped />);
    byText('سوم')!.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(byText('اول'));
  });

  it('wraps Shift+Tab from the first back to the last', () => {
    render(<Trapped />);
    byText('اول')!.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(byText('سوم'));
  });

  it('leaves Tab alone in the middle of the list', () => {
    render(<Trapped />);
    byText('دوم')!.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // The browser handles this move; the trap must not interfere.
    expect(document.activeElement).toBe(byText('دوم'));
  });

  it('closes on Escape when a handler is given', () => {
    const onClose = vi.fn();
    render(<Trapped onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not swallow Escape when the surface cannot be dismissed', () => {
    // The trump sheet relies on this: it has no close handler, so the trap must
    // leave the key alone rather than calling a handler that does not exist.
    const seen: KeyboardEvent[] = [];
    const listener = (event: Event) => seen.push(event as KeyboardEvent);
    document.addEventListener('keydown', listener);
    try {
      render(<Trapped />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.defaultPrevented).toBe(false);
    } finally {
      document.removeEventListener('keydown', listener);
    }
  });

  it('skips disabled controls when choosing where to start', () => {
    render(<Trapped disabledFirst />);
    expect(document.activeElement).toBe(byText('دوم'));
  });

  it('does nothing while inactive', () => {
    const onClose = vi.fn();
    render(<Trapped onClose={onClose} active={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Trapped onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not steal focus back on every render', () => {
    // The handler is usually an inline arrow; keeping it in a ref stops the
    // effect from re-running and yanking focus while the user is tabbing.
    const { rerender } = render(<Trapped onClose={() => {}} />);
    byText('سوم')!.focus();
    rerender(<Trapped onClose={() => {}} />);
    expect(document.activeElement).toBe(byText('سوم'));
  });
});
