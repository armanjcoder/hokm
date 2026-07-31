import { HokmError } from './cards.js';
import { getModeConfig, nextSeatFor } from './modes.js';
import { cloneHands, sortHands, getPlayer, validateDeal, assertUnique } from './internal/state.js';
import type { HokmGameState, Seat } from './types.js';

/**
 * Two player Hokm only: the discard and alternating-draw phases that replace
 * the normal follow-up deal.
 */

/**
 * Two player Hokm: each side burns `discardCount` cards face down before the
 * draw phase begins. Play starts only once both have discarded.
 */
export function discardCards(state: HokmGameState, playerId: string, cardIds: string[]): HokmGameState {
  const config = getModeConfig(state.mode);
  if (state.phase !== 'discarding') {
    throw new HokmError('Discarding is not allowed right now.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if ((state.discardedSeats ?? []).includes(player.seat)) {
    throw new HokmError('This player already discarded.', 'ALREADY_DISCARDED');
  }
  if (cardIds.length !== config.discardCount) {
    throw new HokmError(`Exactly ${config.discardCount} cards must be discarded.`, 'INVALID_DISCARD');
  }
  assertUnique(cardIds, 'Cannot discard the same card twice.', 'INVALID_DISCARD');

  const hands = cloneHands(state.hands);
  const hand = hands[player.seat];
  for (const cardId of cardIds) {
    const index = hand.findIndex((card) => card.id === cardId);
    if (index === -1) throw new HokmError('Card was not found in player hand.', 'CARD_NOT_FOUND');
    hand.splice(index, 1);
  }

  const discardedSeats = [...(state.discardedSeats ?? []), player.seat];
  const everyoneDiscarded = discardedSeats.length >= config.seats;

  return {
    ...state,
    hands,
    discardedSeats,
    // Hakem always draws first.
    phase: everyoneDiscarded ? 'drawing' : 'discarding',
    currentTurnSeat: everyoneDiscarded ? state.hakemSeat : state.currentTurnSeat,
    lastEvent: everyoneDiscarded
      ? 'هر دو بازیکن کارت سوزاندند. حالا نوبت برداشتن از دسته است.'
      : `${player.name} کارت‌هایش را سوزاند.`,
  };
}

/**
 * Two player Hokm draw step: reveals the top stock card to the player on turn.
 * They then keep it (and burn the next one) or burn it (and must take the next).
 */
export function drawCard(state: HokmGameState, playerId: string): HokmGameState {
  if (state.phase !== 'drawing') {
    throw new HokmError('Drawing is not allowed right now.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if (player.seat !== state.currentTurnSeat) {
    throw new HokmError('It is not this player’s turn.', 'NOT_YOUR_TURN');
  }
  if (state.pendingDraw) {
    throw new HokmError('Resolve the revealed card first.', 'DRAW_PENDING');
  }

  const stock = [...(state.stock ?? [])];
  const card = stock.shift();
  if (!card) throw new HokmError('The stock is empty.', 'EMPTY_STOCK');

  return {
    ...state,
    stock,
    pendingDraw: { seat: player.seat, card },
    lastEvent: `${player.name} یک کارت از دسته برداشت.`,
  };
}

/**
 * Resolves a revealed draw.
 *
 * Keeping it means the next stock card is burned unseen; burning it means the
 * next card must be taken sight unseen. That trade-off is the heart of the
 * two player variant.
 */
export function resolveDraw(state: HokmGameState, playerId: string, keep: boolean): HokmGameState {
  const config = getModeConfig(state.mode);
  if (state.phase !== 'drawing' || !state.pendingDraw) {
    throw new HokmError('There is no revealed card to resolve.', 'INVALID_PHASE');
  }
  const player = getPlayer(state, playerId);
  if (player.seat !== state.pendingDraw.seat) {
    throw new HokmError('It is not this player’s turn.', 'NOT_YOUR_TURN');
  }

  const hands = cloneHands(state.hands);
  const stock = [...(state.stock ?? [])];
  const revealed = state.pendingDraw.card;

  if (keep) {
    hands[player.seat].push(revealed);
    // The follow-up card is burned without being seen.
    stock.shift();
  } else {
    const forced = stock.shift();
    // Burning the revealed card obliges the player to take the next one.
    if (forced) hands[player.seat].push(forced);
  }

  const full = [...Array(config.seats).keys()].every(
    (seat) => hands[seat as Seat].length >= config.handSize,
  );
  const stockExhausted = stock.length === 0;
  const done = full || stockExhausted;

  if (done) {
    validateDeal(hands, config);
    return {
      ...state,
      hands: sortHands(hands),
      stock: [],
      pendingDraw: undefined,
      phase: 'playing',
      currentTurnSeat: state.hakemSeat,
      currentTrick: { leaderSeat: state.hakemSeat, plays: [] },
      lastEvent: 'برداشتن کارت‌ها تمام شد. بازی شروع می‌شود.',
    };
  }

  return {
    ...state,
    hands: sortHands(hands),
    stock,
    pendingDraw: undefined,
    currentTurnSeat: nextSeatFor(player.seat, config),
    lastEvent: keep ? `${player.name} کارت را نگه داشت.` : `${player.name} کارت را سوزاند.`,
  };
}
