import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../api/hooks';
import { clearPrivateCaches } from '../lib/pwa';
import { useTheme } from '../lib/theme';
import { useViewport } from '../lib/useViewport';
import s from './Header.module.css';

export function Header() {
  const { vw } = useViewport();
  const { dark, setDark } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const me = useMe().data;
  const onDesk = loc.pathname.startsWith('/desk');
  const showDesk = !!me?.deskTabs.length;
  const items = [
    { label: 'Library', on: !onDesk, go: () => nav('/') },
    ...(showDesk ? [{ label: "Editor's Desk", on: onDesk, go: () => nav('/desk') }] : []),
  ];
  const initials = me ? (me.user.name[0] ?? '') + (me.user.surname[0] ?? '') : '';

  return (
    <header className={s.header} style={{ gap: vw < 600 ? 12 : 28, padding: `0 ${vw < 760 ? 16 : 36}px` }}>
      <button className={s.brand} onClick={() => nav('/')}>
        <span className={s.mark}>
          <span style={{ height: 24, background: 'var(--accent)' }} />
          <span style={{ height: 20, background: 'var(--tan)' }} />
          <span style={{ height: 22, background: 'var(--ink)', transform: 'rotate(9deg)', transformOrigin: 'bottom left' }} />
        </span>
        <span className={s.word}>Memento</span>
      </button>
      <nav className={s.nav} style={{ display: vw < 600 || !me ? 'none' : 'flex' }}>
        {items.map((n) => (
          <button
            key={n.label}
            className={s.pill}
            onClick={n.go}
            style={{ background: n.on ? 'var(--surface2)' : 'transparent', color: n.on ? 'var(--ink)' : 'var(--ink2)' }}
          >
            {n.label}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <button className={s.dark} onClick={() => setDark(!dark)} title="Toggle dark mode" aria-label="Toggle dark mode">
        <span className={s.knob} style={{ transform: `translateX(${dark ? 28 : 0}px)` }}>
          {dark ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          )}
        </span>
      </button>
      {me && <AvatarMenu initials={initials} color={me.user.avatarColor} title={`${me.user.name}${me.user.surname ? ' ' + me.user.surname : ''} · ${accessLabel(me.user.access)}`} />}
    </header>
  );
}

const accessLabel = (a: string) => ({ admin: 'Admin', household_admin: 'Household admin', member: 'Member' })[a] ?? a;

function AvatarMenu({ initials, color, title }: { initials: string; color: string; title: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className={s.avWrap}>
      <button className={s.avatar} style={{ background: color }} title={title} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {initials}
      </button>
      {open && (
        <div className={s.menu} role="menu">
          <div className={s.menuHead}>{title}</div>
          <button
            role="menuitem"
            className={s.menuItem}
            onClick={async () => {
              // Clear local data even when the server call fails (offline, 5xx).
              try {
                await api('/auth/logout', { method: 'POST' });
              } catch {
                // The session cookie expires on its own; local data is what matters here.
              } finally {
                await clearPrivateCaches().catch(() => {});
                qc.clear();
                nav('/login');
              }
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
