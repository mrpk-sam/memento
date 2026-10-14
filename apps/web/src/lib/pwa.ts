import { useEffect, useState } from 'react';

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

const post = (msg: unknown) => navigator.serviceWorker?.controller?.postMessage(msg);

/** Tells the service worker a book was opened, so it keeps that book's photos for offline reading. */
export const noteOpenedBook = (bookId: string, urls: string[]) => post({ type: 'opened-book', bookId, urls });

/** Drops cached book data and unsent shared photos on sign-out so the next person on this device can't see them. */
export async function clearPrivateCaches() {
  post({ type: 'signed-out' });
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('memento-')).map((k) => caches.delete(k)));
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
