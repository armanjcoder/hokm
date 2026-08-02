import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RulesGuide } from '../src/components/RulesGuide.js';
import { shareRoom } from '../src/api/share.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const read = (relative: string) => readFileSync(path.join(srcDir, relative), 'utf8');

afterEach(cleanup);

/**
 * UI audit.
 *
 * Covers accessibility and interaction defects that unit tests of individual
 * components had been missing: modal keyboard behaviour, focus visibility,
 * motion preferences, and the share flow's error paths.
 */

describe('RulesGuide behaves like a real modal dialog', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<RulesGuide mode="classic4" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus into the dialog when it opens', () => {
    render(<RulesGuide mode="classic4" onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'فهمیدم' }));
  });

  it('keeps Tab inside the dialog', () => {
    render(<RulesGuide mode="classic4" onClose={() => {}} />);
    const close = screen.getByRole('button', { name: 'فهمیدم' });
    close.focus();
    // Only one focusable element, so Tab must cycle back to it.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('cycles backwards with Shift+Tab', () => {
    render(<RulesGuide mode="classic4" onClose={() => {}} />);
    const close = screen.getByRole('button', { name: 'فهمیدم' });
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it('removes its key listener when unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = render(<RulesGuide mode="classic4" onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on the backdrop click', () => {
    const onClose = vi.fn();
    render(<RulesGuide mode="classic4" onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('shareRoom never produces an unhandled rejection', () => {
  const loc = { origin: 'https://hokm.test', pathname: '/' };

  it('reports a cancelled share instead of throwing', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const nav = { share: vi.fn().mockRejectedValue(abort), clipboard: { writeText: vi.fn() } };
    await expect(shareRoom('r1', 'https://api.test', nav as any, loc)).resolves.toBe('cancelled');
    expect(nav.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('reports a successful share', async () => {
    const nav = { share: vi.fn().mockResolvedValue(undefined), clipboard: { writeText: vi.fn() } };
    await expect(shareRoom('r1', 'https://api.test', nav as any, loc)).resolves.toBe('shared');
  });

  it('falls back to the clipboard when sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav = { share: undefined, clipboard: { writeText } };
    await expect(shareRoom('r1', 'https://api.test', nav as any, loc)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(
      'https://hokm.test/?room=r1&api=https%3A%2F%2Fapi.test',
    );
  });

  it('falls back to the clipboard when sharing fails for a real reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav = { share: vi.fn().mockRejectedValue(new Error('boom')), clipboard: { writeText } };
    await expect(shareRoom('r1', 'https://api.test', nav as any, loc)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalled();
  });

  it('reports failure when the clipboard is denied too', async () => {
    const nav = {
      share: undefined,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    };
    await expect(shareRoom('r1', 'https://api.test', nav as any, loc)).resolves.toBe('failed');
  });

  it('survives a browser with no clipboard API at all', async () => {
    const nav = { share: undefined, clipboard: undefined };
    await expect(shareRoom('r1', 'https://api.test', nav as any, loc)).resolves.toBe('copied');
  });
});

describe('stylesheet accessibility guarantees', () => {
  const base = read('styles/base.css');

  it('gives keyboard users a visible focus ring', () => {
    expect(base).toContain('button:focus-visible');
    expect(base).toMatch(/outline:\s*3px/);
  });

  it('honours prefers-reduced-motion globally, not per animation', () => {
    const block = base.slice(base.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation-duration: 0.01ms !important');
    expect(block).toContain('transition-duration: 0.01ms !important');
  });
});

describe('every button declares an explicit type', () => {
  const files = [
    'components/GameTable.tsx',
    'components/Landing.tsx',
    'components/Lobby.tsx',
    'components/RulesGuide.tsx',
    'components/Toast.tsx',
    'components/TopBar.tsx',
    'components/DuelPhasePanels.tsx',
    'components/AbandonedNotice.tsx',
  ];

  it.each(files)('%s', (file) => {
    const source = read(file);
    const tags = source.match(/<button\b[^>]*>/gs) ?? [];
    const untyped = tags.filter((tag) => !tag.includes('type='));
    expect(untyped).toEqual([]);
  });
});
