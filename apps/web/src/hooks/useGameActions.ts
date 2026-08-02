import type { Socket } from 'socket.io-client';
import type { Card, PublicGameView, Suit } from '@hokm/game-engine';
import { socketPayload, userMessage, type StoredSession } from '../lib.js';
import { haptic } from '../telegram.js';
import type { ConnectionStatus } from '../types.js';

interface Options {
  socket: Socket;
  session: StoredSession | null;
  game: PublicGameView | undefined;
  connection: ConnectionStatus;
  setToast: (message: string) => void;
}

export interface GameActions {
  chooseSuit: (suit: Suit) => void;
  play: (card: Card) => void;
  nextHand: () => void;
  /** "ده‌لو کم": ask for a fresh deal when the opening hand is weak. */
  requestRedeal: () => void;
  /** Two player mode: burn the selected cards. */
  discard: (cardIds: string[]) => void;
  /** Two player mode: reveal the next stock card. */
  draw: () => void;
  /** Two player mode: keep or burn the revealed card. */
  resolveDraw: (keep: boolean) => void;
  /** Reports that this client finished showing the hakem draw. */
  hakemDrawDone: () => void;
  /** Blocks actions that would be silently dropped while the socket is down. */
  requireConnection: () => boolean;
}

/** Socket emitters for in-game moves, each guarded by connection state. */
export function useGameActions({ socket, session, game, connection, setToast }: Options): GameActions {
  function requireConnection(): boolean {
    if (connection === 'connected') return true;
    haptic('error');
    setToast('ارتباط با سرور قطع است. تا وصل شدن دوباره صبر کن.');
    return false;
  }

  function ackToast(response: any) {
    if (response?.ok === false) {
      // A rejected move is worth feeling: the player usually has not noticed
      // why nothing happened.
      haptic('error');
      setToast(userMessage(response, 'این حرکت انجام نشد. دوباره تلاش کن.'));
    }
  }

  return {
    requireConnection,
    chooseSuit(suit) {
      if (!session || !requireConnection()) return;
      haptic('select');
      socket.emit('game:choose_trump', { ...socketPayload(session), suit }, ackToast);
    },
    play(card) {
      if (!session) return;
      // Tapping a card that cannot be played is a real mistake, so say so with
      // a buzz rather than silently ignoring the tap.
      if (!game?.validCardIds.includes(card.id)) {
        haptic('error');
        return;
      }
      if (!requireConnection()) return;
      haptic('play');
      socket.emit('game:play_card', { ...socketPayload(session), cardId: card.id }, ackToast);
    },
    hakemDrawDone() {
      // Fire and forget: the server ignores repeats, and a dropped frame here
      // must never block the hand from starting.
      if (!session) return;
      socket.emit('game:hakem_draw_done', socketPayload(session));
    },
    nextHand() {
      if (!session || !requireConnection()) return;
      socket.emit('game:next_hand', socketPayload(session), ackToast);
    },
    requestRedeal() {
      if (!session || !requireConnection()) return;
      socket.emit('game:redeal', socketPayload(session), ackToast);
    },
    discard(cardIds) {
      if (!session || !requireConnection()) return;
      haptic('play');
      socket.emit('game:discard', { ...socketPayload(session), cardIds }, ackToast);
    },
    draw() {
      if (!session || !requireConnection()) return;
      haptic('select');
      socket.emit('game:draw', socketPayload(session), ackToast);
    },
    resolveDraw(keep) {
      if (!session || !requireConnection()) return;
      socket.emit('game:resolve_draw', { ...socketPayload(session), keep }, ackToast);
    },
  };
}
