import type { ReactNode } from 'react';
import type { Card, PublicGameView, Suit } from '@hokm/game-engine';
import type { StoredSession } from '../lib.js';
import type { BotDifficulty, ConnectionStatus, RoomPlayer, RoomView } from '../types.js';
import { AbandonedNotice } from './AbandonedNotice.js';
import { GameTable } from './GameTable.js';
import { Lobby } from './Lobby.js';
import { StartOverlay } from './StartOverlay.js';
import { Toast } from './Toast.js';
import { TopBar } from './TopBar.js';

interface LobbyHandlers {
  toggleReady: () => void;
  addBot: (difficulty: BotDifficulty) => void;
  setBotDifficulty: (botId: string, difficulty: BotDifficulty) => void;
  removeBot: (botId: string) => void;
  leaveRoom: () => void;
  updateSettings: (patch: {
    mode?: string;
    targetScore?: number;
    rules?: { lowHandRedeal?: boolean; bam?: boolean };
  }) => void;
}

interface TableHandlers {
  chooseSuit: (suit: Suit) => void;
  play: (card: Card) => void;
  nextHand: () => void;
  requestRedeal: () => void;
  discard: (cardIds: string[]) => void;
  draw: () => void;
  resolveDraw: (keep: boolean) => void;
}

/** Everything shown once the player is seated at a table. */
export function TableScreen({
  room,
  session,
  me,
  game,
  apiUrl,
  connection,
  toast,
  starting,
  lobbyBusy,
  rulesOverlay,
  setToast,
  showRules,
  onNewTable,
  lobby,
  table,
  invite,
}: {
  room: RoomView;
  session: StoredSession;
  me: RoomPlayer | undefined;
  game: PublicGameView | undefined;
  apiUrl: string;
  connection: ConnectionStatus;
  toast: string;
  starting: boolean;
  lobbyBusy: boolean;
  rulesOverlay: ReactNode;
  setToast: (message: string) => void;
  showRules: () => void;
  onNewTable: () => void;
  lobby: LobbyHandlers;
  table: TableHandlers;
  invite: () => void;
}) {
  return (
    <main className="app-shell">
      <TopBar
        room={room}
        me={me}
        apiUrl={apiUrl}
        connection={connection}
        showRules={showRules}
        leaveRoom={room.status === 'abandoned' ? undefined : lobby.leaveRoom}
        leaveBusy={lobbyBusy}
      />

      {room.status === 'lobby' && (
        <Lobby
          room={room}
          me={me}
          isHost={room.hostPlayerId === session.playerId}
          busy={lobbyBusy}
          invite={invite}
          showRules={showRules}
          toggleReady={lobby.toggleReady}
          addBot={lobby.addBot}
          setBotDifficulty={lobby.setBotDifficulty}
          removeBot={lobby.removeBot}
          updateSettings={lobby.updateSettings}
        />
      )}

      {room.status === 'abandoned' && <AbandonedNotice onNewTable={onNewTable} />}

      {room.status !== 'lobby' && room.status !== 'abandoned' && game && (
        <GameTable
          room={room}
          game={game}
          meId={session.playerId}
          dealReady={!starting}
          {...table}
        />
      )}

      {/* A table can be marked as playing while its game state is missing, for
          example after a partially written save. Without this the screen would
          be blank and the player would have no way out except closing the app. */}
      {room.status !== 'lobby' && room.status !== 'abandoned' && !game && (
        <section className="glass wait-card phase-card">
          <h3>میز در دسترس نیست</h3>
          <p>وضعیت این میز روی سرور ناقص است. می‌توانی از میز خارج شوی و میز تازه بسازی.</p>
          <button
            className="ghost danger"
            type="button"
            disabled={lobbyBusy}
            onClick={lobby.leaveRoom}
          >
            خروج از میز
          </button>
        </section>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
      {starting && <StartOverlay />}
      {rulesOverlay}
    </main>
  );
}
