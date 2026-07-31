import type { Socket } from 'socket.io-client';
import type { Card, PublicGameView, Suit } from '@hokm/game-engine';
import { socketPayload, userMessage, type StoredSession } from '../lib.js';
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
  /** Blocks actions that would be silently dropped while the socket is down. */
  requireConnection: () => boolean;
}

/** Socket emitters for in-game moves, each guarded by connection state. */
export function useGameActions({ socket, session, game, connection, setToast }: Options): GameActions {
  function requireConnection(): boolean {
    if (connection === 'connected') return true;
    setToast('ارتباط با سرور قطع است. تا وصل شدن دوباره صبر کن.');
    return false;
  }

  function ackToast(response: any) {
    if (response?.ok === false) {
      setToast(userMessage(response, 'این حرکت انجام نشد. دوباره تلاش کن.'));
    }
  }

  return {
    requireConnection,
    chooseSuit(suit) {
      if (!session || !requireConnection()) return;
      socket.emit('game:choose_trump', { ...socketPayload(session), suit }, ackToast);
    },
    play(card) {
      if (!session || !game?.validCardIds.includes(card.id)) return;
      if (!requireConnection()) return;
      socket.emit('game:play_card', { ...socketPayload(session), cardId: card.id }, ackToast);
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
      socket.emit('game:discard', { ...socketPayload(session), cardIds }, ackToast);
    },
    draw() {
      if (!session || !requireConnection()) return;
      socket.emit('game:draw', socketPayload(session), ackToast);
    },
    resolveDraw(keep) {
      if (!session || !requireConnection()) return;
      socket.emit('game:resolve_draw', { ...socketPayload(session), keep }, ackToast);
    },
  };
}
