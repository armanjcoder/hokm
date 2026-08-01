import { useEffect, useRef, type RefObject } from 'react';

/**
 * Keyboard behaviour every modal surface needs.
 *
 * A dialog has to own the keyboard while it is open: Escape closes it and Tab
 * cycles inside it, otherwise focus wanders onto the page behind and a keyboard
 * user is silently stranded. Shared so each new sheet does not reimplement it
 * and quietly get a detail wrong.
 */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  /** The surface to trap focus inside. */
  containerRef: RefObject<HTMLElement | null>;
  /** Called on Escape. Omit to make the surface non-dismissable. */
  onClose?: (() => void) | undefined;
  /** Receives focus when the surface opens. Falls back to the first control. */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** Set false to leave the keyboard alone, e.g. while the surface is hidden. */
  active?: boolean;
}

export function useFocusTrap({
  containerRef,
  onClose,
  initialFocusRef,
  active = true,
}: FocusTrapOptions): void {
  // Kept in a ref so an inline arrow does not re-run the effect every render,
  // which would steal focus back on each keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    const focusables = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    (initialFocusRef?.current ?? focusables()[0])?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!closeRef.current) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, containerRef, initialFocusRef]);
}
