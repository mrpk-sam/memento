import { useOnline } from '../lib/pwa';
import s from './OfflineBanner.module.css';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className={s.bar} role="status">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 0 1 7 0" /><path d="M2 8.8a15 15 0 0 1 4.2-2.7" /><path d="M10.7 5.1A15 15 0 0 1 22 8.8" /><path d="M5 12.6a10 10 0 0 1 5.2-2.4" /><path d="M16.9 11.2A10 10 0 0 1 19 12.6" /><circle cx="12" cy="20" r="1" /></svg>
      You're offline. Books you opened recently still read fine; editing is paused.
    </div>
  );
}
