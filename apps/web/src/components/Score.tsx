export function Score({ title, match, tricks }: { title: string; match: number; tricks: number }) {
  return <div className="score"><small>{title}</small><strong>{match}</strong><span>{tricks} دست</span></div>;
}
