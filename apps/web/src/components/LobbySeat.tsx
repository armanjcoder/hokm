import { initialsFor } from '../table-seats.js';
import { DIFFICULTY_OPTIONS, type BotDifficulty, type RoomPlayer } from '../types.js';
import { Avatar } from './Avatar.js';

/**
 * One chair in the lobby.
 *
 * The lobby is where players work out who they are playing with, so a seat has
 * to answer three questions at a glance: who is sitting here, are they ready,
 * and are they on my side. The same avatar appears at the table, so a partner
 * recognised here is still recognisable once the hand starts.
 */
export function LobbySeat({
  seat,
  player,
  isMe,
  isHost,
  isPartner,
  teamPlay,
  myTeam,
  viewerIsHost,
  busy,
  photoUrl,
  setBotDifficulty,
  removeBot,
}: {
  seat: number;
  player: RoomPlayer | undefined;
  isMe: boolean;
  /** This seat created the table. */
  isHost: boolean;
  isPartner: boolean;
  teamPlay: boolean;
  /** True when this seat plays on the viewer's side, including the viewer. */
  myTeam: boolean;
  /** The viewer created the table, so may manage bots. */
  viewerIsHost: boolean;
  busy: boolean;
  /** Proxied Telegram photo for this seat, when the player has a public one. */
  photoUrl?: string | undefined;
  setBotDifficulty: (botId: string, difficulty: BotDifficulty) => void;
  removeBot: (botId: string) => void;
}) {
  const offline = Boolean(player) && !player?.isBot && !player?.connected;
  const empty = !player;
  const difficulty = player?.difficulty ?? 'medium';

  const classes = [
    'seat-card',
    offline && 'offline',
    player?.ready && 'ready',
    empty && 'is-empty',
    teamPlay && (myTeam ? 'team-ours' : 'team-theirs'),
  ]
    .filter(Boolean)
    .join(' ');

  // One sentence, so a screen reader gets what colour and layout convey.
  const described = [
    `صندلی ${seat + 1}`,
    player ? player.name : 'خالی',
    isMe ? 'خودت' : isPartner ? 'یار تو' : '',
    isHost ? 'سازنده میز' : '',
    player?.isBot ? 'ربات' : '',
    player?.ready ? 'آماده' : offline ? 'ارتباطش قطع شده' : player ? 'در انتظار آمادگی' : '',
  ]
    .filter(Boolean)
    .join('، ');

  return (
    <div className={classes} role="listitem" aria-label={described}>
      <div className="seat-card__head">
        <Avatar
          initials={initialsFor(player?.name, seat)}
          tone={empty ? 'empty' : teamPlay ? (myTeam ? 'ours' : 'theirs') : 'solo'}
          isBot={Boolean(player?.isBot)}
          photoUrl={photoUrl}
        />
        <span className="seat-card__identity">
          <strong className="seat-card__name">{player ? player.name : 'در انتظار بازیکن…'}</strong>
          <span className="seat-card__tags">
            {isMe && <em className="tag tag--self">تو</em>}
            {isPartner && <em className="tag tag--partner">یار</em>}
            {isHost && <em className="tag tag--host">سازنده</em>}
            {player?.isBot && <em className="tag tag--bot">ربات</em>}
          </span>
        </span>
      </div>

      <div className="seat-footer">
        {player && !player.isBot && (
          <em className={`seat-status ${player.ready ? 'is-ready' : ''}`}>
            {player.ready ? 'آماده ✓' : offline ? 'قطع شده' : 'در انتظار آمادگی'}
          </em>
        )}

        {player?.isBot && viewerIsHost && (
          <div className="bot-controls">
            <select
              className="bot-difficulty"
              aria-label={`سطح سختی ${player.name}`}
              value={difficulty}
              disabled={busy}
              onChange={(event) => setBotDifficulty(player.id, event.target.value as BotDifficulty)}
            >
              {DIFFICULTY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              className="seat-remove"
              type="button"
              disabled={busy}
              aria-label={`حذف ${player.name}`}
              onClick={() => removeBot(player.id)}
            >
              حذف
            </button>
          </div>
        )}

        {player?.isBot && !viewerIsHost && (
          <em className="seat-status">
            {DIFFICULTY_OPTIONS.find((option) => option.id === difficulty)?.label}
          </em>
        )}
      </div>
    </div>
  );
}
