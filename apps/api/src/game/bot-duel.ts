import { cardRankValue, type Card, type HokmGameState, type Seat, type Suit } from '@hokm/game-engine';
import type { BotDifficulty } from './bot-ai.js';

/** Bot decisions that only exist in the two player duel variant. */

/** Two player mode: which cards to burn before the draw phase. */
export function chooseDiscards(
  game: HokmGameState,
  seat: Seat,
  count: number,
  difficulty: BotDifficulty,
): string[] {
  const hand = [...game.hands[seat]];
  // Every level keeps trumps and high cards now; easy simply values them less.
  const trumpBonus = difficulty === 'easy' ? 20 : 100;
  return hand
    .sort((a, b) => discardValue(a, game.trumpSuit, trumpBonus) - discardValue(b, game.trumpSuit, trumpBonus))
    .slice(0, count)
    .map((card) => card.id);
}

function discardValue(card: Card, trump: Suit | undefined, trumpBonus: number): number {
  return cardRankValue(card) + (card.suit === trump ? trumpBonus : 0);
}

/** Two player mode: whether to keep a revealed stock card. */
export function shouldKeepDraw(
  card: Card,
  trump: Suit | undefined,
  difficulty: BotDifficulty,
): boolean {
  // Trumps are always worth keeping.
  if (card.suit === trump) return true;
  // Otherwise only genuinely strong cards; easy bots are less selective.
  const threshold = difficulty === 'hard' ? 11 : difficulty === 'medium' ? 10 : 9;
  return cardRankValue(card) >= threshold;
}
