export function Score({
  title,
  match,
  tricks,
  /** Names on this side, so "team 1" is not an anonymous label. */
  members,
  /** Marks the viewer's own side, matching the seat colours on the table. */
  ours,
}: {
  title: string;
  match: number;
  tricks: number;
  members?: string[];
  ours?: boolean;
}) {
  return (
    <div className={`score ${ours ? 'score--ours' : ''}`}>
      <small>{title}</small>
      <strong>{match}</strong>
      <span>{tricks} دست</span>
      {members && members.length > 0 && (
        <em className="score__members" title={members.join('، ')}>
          {members.join('، ')}
        </em>
      )}
    </div>
  );
}
