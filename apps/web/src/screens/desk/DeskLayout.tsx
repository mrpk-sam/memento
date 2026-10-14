import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMe } from '../../api/hooks';
import { useViewport } from '../../lib/useViewport';
import { useDeskCounts } from './counts';
import { FamilyTab } from './FamilyTab';
import { BooksTab } from './BooksTab';
import { AiTab } from './AiTab';
import { InboxTab } from './InboxTab';
import { ThemesTab } from './ThemesTab';
import { SettingsTab } from './SettingsTab';
import s from './Desk.module.css';

const ICONS: Record<string, ReactNode> = {
  family: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14a6 6 0 0 1 3.5 6" /></svg>,
  books: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5A1.5 1.5 0 0 0 4 20.5z" /><path d="M4 20.5A1.5 1.5 0 0 0 5.5 22H20" /></svg>,
  themes: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><circle cx="8" cy="10" r="1.2" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="16" cy="10" r="1.2" /><path d="M12 21a2 2 0 0 1 0-4h2a3 3 0 0 0 3-3" /></svg>,
  inbox: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></svg>,
  ai: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z" /></svg>,
  settings: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>,
};

const LABELS: Record<string, string> = {
  family: 'Family members',
  books: 'Books',
  themes: 'Theme library',
  inbox: 'Photo inbox',
  ai: 'AI captions',
  settings: 'Settings',
};

/** Tab bodies register here as each phase lands. */
const TABS: Record<string, () => ReactNode> = {
  family: () => <FamilyTab />,
  books: () => <BooksTab />,
  themes: () => <ThemesTab />,
  inbox: () => <InboxTab />,
  ai: () => <AiTab />,
  settings: () => <SettingsTab />,
};

export function Desk() {
  const { tab = 'family' } = useParams();
  const nav = useNavigate();
  const { vw } = useViewport();
  const me = useMe().data;
  const counts = useDeskCounts(me?.deskTabs ?? []);
  if (!me) return null;
  if (!me.deskTabs.length) return <Navigate to="/" replace />;
  if (!me.deskTabs.includes(tab)) return <Navigate to={`/desk/${me.deskTabs[0]}`} replace />;
  const narrow = vw < 900;
  const Body = TABS[tab];

  return (
    <section className={s.desk} style={{ gridTemplateColumns: narrow ? 'minmax(0,1fr)' : '264px minmax(0,1fr)' }}>
      <aside
        className={s.side}
        style={{
          position: narrow ? 'static' : 'sticky',
          flexDirection: narrow ? 'row' : 'column',
          padding: narrow ? '10px 12px' : '28px 16px',
          borderRight: narrow ? '0' : '1px solid var(--line)',
          borderBottom: narrow ? '1px solid var(--line)' : '0',
          minHeight: narrow ? 0 : 'calc(100dvh - 68px)',
        }}
      >
        <div className={s.sideLabel} style={{ display: narrow ? 'none' : 'block' }}>
          Editor's Desk
        </div>
        {me.deskTabs.map((id) => {
          const on = id === tab;
          return (
            <button
              key={id}
              className={s.tab}
              onClick={() => nav(`/desk/${id}`)}
              style={{
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--ink)' : 'var(--ink2)',
                boxShadow: on ? '0 1px 2px rgba(0,0,0,.06), 0 0 0 1px var(--line)' : 'none',
              }}
            >
              {ICONS[id]}
              <span style={{ flex: 1 }}>{LABELS[id]}</span>
              <span className={s.count}>{counts[id] ?? ''}</span>
            </button>
          );
        })}
      </aside>
      <main className={s.main} style={{ padding: narrow ? '24px 16px 80px' : '40px 48px 80px' }}>
        {Body ? Body() : <p className={s.lead}>Coming soon.</p>}
      </main>
    </section>
  );
}
