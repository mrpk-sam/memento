import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from './api/client';
import { useMe } from './api/hooks';
import { Header } from './components/Header';
import { OfflineBanner } from './components/OfflineBanner';
import { Login, Verify } from './screens/Login';
import { Desk } from './screens/desk/DeskLayout';
import { Shelf } from './screens/shelf/Shelf';
import { BookScreen } from './screens/reader/BookScreen';

function RequireAuth() {
  const me = useMe();
  const loc = useLocation();
  // Render the app only once we know who's signed in. Anything else is a redirect,
  // an error message, or a blank moment while the first check runs.
  if (me.data) return <Outlet />;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  if (me.error) return <Unavailable message={me.error.message} retry={() => void me.refetch()} busy={me.isFetching} />;
  return null;
}

function Unavailable({ message, retry, busy }: { message: string; retry: () => void; busy: boolean }) {
  return (
    <section style={{ minHeight: 'calc(100dvh - 68px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, background: 'var(--wall)', textAlign: 'center' }}>
      <div style={{ font: '400 26px/1.2 var(--font-serif)' }}>Memento can't load right now</div>
      <div style={{ font: '400 15px/1.5 var(--font-ui)', color: 'var(--ink2)', maxWidth: 420 }}>{message}</div>
      <button
        onClick={retry}
        disabled={busy}
        style={{ height: 42, padding: '0 20px', borderRadius: 999, border: 0, background: 'var(--ink)', color: 'var(--bg)', font: '500 14px/1 var(--font-ui)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Trying…' : 'Try again'}
      </button>
    </section>
  );
}

export function App() {
  return (
    <div className="app-root">
      <Header />
      <OfflineBanner />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/verify" element={<Verify />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Shelf />} />
          <Route path="/book/:id" element={<BookScreen />} />
          <Route path="/share-target" element={<Navigate to="/desk/inbox" replace />} />
          <Route path="/desk" element={<Desk />} />
          <Route path="/desk/:tab" element={<Desk />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </div>
  );
}
