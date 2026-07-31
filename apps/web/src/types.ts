import type { PublicGameView, Suit } from '@hokm/game-engine';

export type RoomStatus = 'lobby' | 'playing' | 'finished' | 'abandoned';

export interface RoomPlayer {
  id: string;
  name: string;
  telegramId?: number;
  seat: number;
  connected: boolean;
  ready?: boolean;
  isBot?: boolean;
}

export interface Readiness {
  waitingOn: string[];
  humanCount: number;
  botCount: number;
  canStart: boolean;
}

export interface RoomView {
  id: string;
  code: string;
  status: RoomStatus;
  hostPlayerId?: string;
  readiness?: Readiness;
  players: RoomPlayer[];
  game?: PublicGameView;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

/**
 * `idle`     -> a saved session exists but we have not tried to use it yet
 * `resuming` -> actively re-joining the saved table
 * `active`   -> we are in the table
 */
export type SessionPhase = 'idle' | 'resuming' | 'active';

export interface SuitMeta {
  id: Suit;
  label: string;
  symbol: string;
  color: 'red' | 'black';
}

export const SUIT_META: SuitMeta[] = [
  { id: 'spades', label: 'پیک', symbol: '♠', color: 'black' },
  { id: 'hearts', label: 'دل', symbol: '♥', color: 'red' },
  { id: 'diamonds', label: 'خشت', symbol: '♦', color: 'red' },
  { id: 'clubs', label: 'گشنیز', symbol: '♣', color: 'black' },
];

export function suitMeta(suit: Suit): SuitMeta {
  return SUIT_META.find((meta) => meta.id === suit) ?? SUIT_META[0]!;
}

export function suitSymbol(suit: Suit): string {
  return SUIT_META.find((meta) => meta.id === suit)?.symbol ?? '؟';
}

export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connected: 'آنلاین',
  connecting: 'در حال اتصال دوباره…',
  offline: 'آفلاین',
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        /** Raw signed payload. This is the only value the backend trusts. */
        initData?: string;
        initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
      };
    };
  }
}
