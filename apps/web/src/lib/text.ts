export { poss } from '@memento/shared';

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function inviteStatus(sentAt: string, expiresAt: string) {
  const now = Date.now();
  const days = Math.floor((now - new Date(sentAt).getTime()) / 864e5);
  const left = Math.ceil((new Date(expiresAt).getTime() - now) / 864e5);
  const sent = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return left <= 0
    ? { label: 'Invite expired', expired: true }
    : { label: `Invited ${sent} · expires in ${left} day${left === 1 ? '' : 's'}`, expired: false };
}

/** 83 500 ms → "1:24". */
export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
