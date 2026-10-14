import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { App } from './App';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import { registerServiceWorker } from './lib/pwa';
import '@phosphor-icons/web/duotone';
import './styles/tokens.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
      // A failed query must not refetch just because another component mounted:
      // that flips it back to "loading", remounts the page, and loops.
      retryOnMount: false,
    },
  },
  queryCache: new QueryCache({
    onError: (e, query) => {
      // A session lost mid-use sends the user back to sign in. The ['me'] query is
      // left alone: RequireAuth redirects on its 401, and refetching it here would
      // clear the error and loop forever.
      if (!(e instanceof ApiError) || e.status !== 401 || query.queryKey[0] === 'me') return;
      if (location.pathname.startsWith('/login') || location.pathname.startsWith('/auth/')) return;
      location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    },
  }),
});

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
