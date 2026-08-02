import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameView } from '@hokm/game-engine';
import { DuelPhasePanels } from '../src/components/DuelPhasePanels.js';

afterEach(cleanup);

/**
 * The two player discard and draw steps.
 *
 * These phases exist only in `duel2` and are the most unusual rules in the
 * game: you burn two cards, then draw one at a time, choosing blind whether to
 * keep what you see. Getting the wording or the buttons wrong here makes the
 * variant unplayable, and none of it was covered before.
 */

const card = (id: string) => ({ id, suit: 'spades', rank: 'A' }) as never;

function game(over: Partial<PublicGameView> = {}): PublicGameView {
  return {
    mode: 'duel2',
    phase: 'discarding',
    stockCount: 12,
    currentTrick: { leaderSeat: 0, plays: [] },
    completedTricks: [],
    ...over,
  } as unknown as PublicGameView;
}

function renderPanels(over: Partial<Parameters<typeof DuelPhasePanels>[0]> = {}) {
  const props = {
    game: game(),
    discarding: true,
    discardCount: 2,
    selected: [] as string[],
    isMyTurn: true,
    confirmDiscard: vi.fn(),
    draw: vi.fn(),
    resolveDraw: vi.fn(),
    ...over,
  };
  render(<DuelPhasePanels {...props} />);
  return props;
}

describe('nothing shows outside the duel phases', () => {
  it.each(['playing', 'waiting_for_trump', 'hand_complete'])('is silent during %s', (phase) => {
    const { container } = render(
      <DuelPhasePanels
        game={game({ phase } as Partial<PublicGameView>)}
        discarding={false}
        discardCount={2}
        selected={[]}
        isMyTurn
        confirmDiscard={() => {}}
        draw={() => {}}
        resolveDraw={() => {}}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('burning cards', () => {
  it('says how many cards to burn', () => {
    renderPanels({ discardCount: 2 });
    expect(screen.getByText('2 کارت بسوزان')).toBeDefined();
  });

  it('reassures the player that the opponent cannot see them', () => {
    renderPanels();
    expect(screen.getByText(/حریف آن‌ها را نمی‌بیند/)).toBeDefined();
  });

  it('shows progress towards the required count', () => {
    renderPanels({ selected: ['a'] });
    expect(screen.getByRole('button', { name: 'سوزاندن 1/2' })).toBeDefined();
  });

  it('blocks confirming until exactly the right number is chosen', () => {
    renderPanels({ selected: ['a'] });
    expect((screen.getByRole('button', { name: /سوزاندن/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('enables confirming once the count matches', () => {
    renderPanels({ selected: ['a', 'b'] });
    expect((screen.getByRole('button', { name: 'سوزاندن 2/2' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('confirms the burn when pressed', () => {
    const props = renderPanels({ selected: ['a', 'b'] });
    fireEvent.click(screen.getByRole('button', { name: 'سوزاندن 2/2' }));
    expect(props.confirmDiscard).toHaveBeenCalledOnce();
  });

  it('waits quietly once you have already burned yours', () => {
    renderPanels({ discarding: false });
    expect(screen.getByText(/منتظر حریف/)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('drawing from the stock', () => {
  const drawing = (over: Partial<PublicGameView> = {}) =>
    game({ phase: 'drawing', ...over } as Partial<PublicGameView>);

  it('shows how many cards are left', () => {
    renderPanels({ game: drawing({ stockCount: 7 } as Partial<PublicGameView>) });
    expect(screen.getByText('7 کارت در دسته مانده است.')).toBeDefined();
  });

  it('copes with an unknown stock count', () => {
    renderPanels({ game: drawing({ stockCount: undefined } as unknown as Partial<PublicGameView>) });
    expect(screen.getByText('0 کارت در دسته مانده است.')).toBeDefined();
  });

  it('offers to draw when it is your turn', () => {
    renderPanels({ game: drawing(), isMyTurn: true });
    expect(screen.getByRole('button', { name: 'برداشتن کارت' })).toBeDefined();
  });

  it('draws when pressed', () => {
    const props = renderPanels({ game: drawing(), isMyTurn: true });
    fireEvent.click(screen.getByRole('button', { name: 'برداشتن کارت' }));
    expect(props.draw).toHaveBeenCalledOnce();
  });

  it('waits when it is the opponent turn', () => {
    renderPanels({ game: drawing(), isMyTurn: false });
    expect(screen.getByText('نوبت حریف است…')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('deciding on a revealed card', () => {
  const pending = () =>
    game({
      phase: 'drawing',
      pendingDraw: { seat: 0, card: card('revealed') },
    } as unknown as Partial<PublicGameView>);

  it('shows the card that was turned over', () => {
    renderPanels({ game: pending() });
    expect(screen.getByTitle('A پیک')).toBeDefined();
  });

  it('offers both choices', () => {
    renderPanels({ game: pending() });
    expect(screen.getByRole('button', { name: 'نگه می‌دارم' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'می‌سوزانم' })).toBeDefined();
  });

  it('spells out the consequence of each choice', () => {
    // This rule is the one newcomers get wrong, so the panel states it plainly.
    renderPanels({ game: pending() });
    expect(screen.getByText(/اگر نگه داری، کارت بعدی نادیده سوزانده می‌شود/)).toBeDefined();
  });

  it('reports keeping the card', () => {
    const props = renderPanels({ game: pending() });
    fireEvent.click(screen.getByRole('button', { name: 'نگه می‌دارم' }));
    expect(props.resolveDraw).toHaveBeenCalledWith(true);
  });

  it('reports burning the card', () => {
    const props = renderPanels({ game: pending() });
    fireEvent.click(screen.getByRole('button', { name: 'می‌سوزانم' }));
    expect(props.resolveDraw).toHaveBeenCalledWith(false);
  });

  it('replaces the draw button while a card is pending', () => {
    renderPanels({ game: pending(), isMyTurn: true });
    expect(screen.queryByRole('button', { name: 'برداشتن کارت' })).toBeNull();
  });
});
