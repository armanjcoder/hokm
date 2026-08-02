import type { GameMode, PublicGameView, Suit } from '@hokm/game-engine';

export type RoomStatus = 'lobby' | 'playing' | 'finished' | 'abandoned';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_OPTIONS: Array<{ id: BotDifficulty; label: string }> = [
  { id: 'easy', label: 'آسان' },
  { id: 'medium', label: 'متوسط' },
  { id: 'hard', label: 'سخت' },
];

export interface RoomPlayer {
  id: string;
  name: string;
  telegramId?: number;
  /**
   * True when this player signed in from Telegram with a public profile photo.
   * The URL itself never leaves the server; ask the API for the image with
   * `avatarUrl()`.
   */
  hasPhoto?: boolean;
  seat: number;
  connected: boolean;
  ready?: boolean;
  isBot?: boolean;
  difficulty?: BotDifficulty;
}

export interface Readiness {
  waitingOn: string[];
  humanCount: number;
  botCount: number;
  canStart: boolean;
}

export const MODE_OPTIONS: Array<{ id: GameMode; label: string; hint: string }> = [
  { id: 'classic4', label: '۴ نفره', hint: 'دو تیم دو نفره' },
  { id: 'solo3', label: '۳ نفره', hint: 'هرکس برای خودش' },
  { id: 'duel2', label: '۲ نفره', hint: 'دونفره با سوزاندن و برداشتن' },
];

export const TARGET_SCORE_OPTIONS = [3, 5, 7, 11] as const;

export interface RoomView {
  id: string;
  code: string;
  mode?: GameMode;
  targetScore?: number;
  rules?: { lowHandRedeal: boolean; maxRedeals: number; bam: boolean };
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

/**
 * The parts of the Telegram Mini App SDK this app uses.
 *
 * Everything is optional: the app runs in a plain browser during development,
 * and older Telegram clients ship older SDKs where newer methods simply do not
 * exist. Every call site must therefore feature-detect rather than assume.
 */
export interface TelegramHaptics {
  impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged?: () => void;
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  /** Raw signed payload. This is the only value the backend trusts. */
  initData?: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
  /** Added in Bot API 6.1. */
  HapticFeedback?: TelegramHaptics;
  /** Height excluding the on-screen keyboard; stable across scroll. */
  viewportStableHeight?: number;
  viewportHeight?: number;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  /** Added in Bot API 6.1; only accepts a hex colour in 6.9+. */
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  /** Keeps a swipe-down from closing the app mid-game. Bot API 7.7. */
  disableVerticalSwipes?: () => void;
  /** Version of the Bot API the host client implements, e.g. "7.0". */
  version?: string;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
