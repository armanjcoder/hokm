import { useState } from 'react';
import { HokmRequestError, type StoredSession } from '../lib.js';
import { lobbyActionRequest } from '../api/client.js';
import type { RoomView } from '../types.js';

interface Options {
  apiUrl: string;
  room: RoomView | null;
  session: StoredSession | null;
  me: { ready?: boolean } | undefined;
  requireConnection: () => boolean;
  setToast: (message: string) => void;
  /** Called when a lobby action caused the game to start. */
  onGameStarted: () => void;
  onLeft: () => void;
}

export interface LobbyActions {
  toggleReady: () => Promise<void>;
  /** Host-only: change the table rules from the lobby. */
  updateSettings: (patch: { mode?: string; targetScore?: number }) => Promise<void>;
  addBot: (difficulty: string) => Promise<void>;
  setBotDifficulty: (botId: string, difficulty: string) => void;
  removeBot: (botId: string) => void;
  leaveRoom: () => Promise<void>;
  /** True while a request is in flight, so buttons can be disabled. */
  busy: boolean;
}

/** Lobby buttons: readiness, bot management and leaving the table. */
export function useLobbyActions({
  apiUrl,
  room,
  session,
  me,
  requireConnection,
  setToast,
  onGameStarted,
  onLeft,
}: Options): LobbyActions {
  const [busy, setBusy] = useState(false);

  async function run(path: string, extra: Record<string, unknown>, fallback: string) {
    if (!room || !session || !requireConnection()) return undefined;
    setBusy(true);
    try {
      return await lobbyActionRequest(apiUrl, room.id, path, session, extra, fallback);
    } catch (error) {
      setToast(error instanceof HokmRequestError ? error.message : fallback);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,

    async toggleReady() {
      const data = await run('ready', { ready: !me?.ready }, 'ثبت آمادگی انجام نشد.');
      if (data?.started) onGameStarted();
    },

    async updateSettings(patch) {
      const data = await run('settings', patch, 'تغییر تنظیمات میز انجام نشد.');
      if (data?.started) onGameStarted();
    },

    async addBot(difficulty) {
      const data = await run('add-bot', { difficulty }, 'اضافه کردن ربات انجام نشد.');
      if (data?.started) onGameStarted();
    },

    setBotDifficulty(botId, difficulty) {
      void run('bot-difficulty', { botId, difficulty }, 'تغییر سطح ربات انجام نشد.');
    },

    removeBot(botId) {
      void run('remove-bot', { botId }, 'حذف ربات انجام نشد.');
    },

    async leaveRoom() {
      const data = await run('leave', {}, 'خروج از میز انجام نشد.');
      if (data) onLeft();
    },
  };
}
