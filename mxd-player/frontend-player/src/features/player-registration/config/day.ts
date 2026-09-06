const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Formats the backend's Beijing target day for player-facing labels. */
export function formatTargetDay(day: string): string {
  const match = DAY_PATTERN.exec(day);
  if (!match) return day;
  return `${Number(match[2])}.${Number(match[3])}日`;
}

/** Returns the Beijing calendar day immediately before the backend target day. */
export function formatLockDay(day: string): string {
  const match = DAY_PATTERN.exec(day);
  if (!match) return '';
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return `${value.getUTCMonth() + 1}.${value.getUTCDate()}日`;
}
