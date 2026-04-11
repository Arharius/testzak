import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { App } from './App';
import { BACKEND_URL } from './lib/backendApi';
import './styles.css';

if (import.meta.env.PROD && BACKEND_URL) {
  const ping = () => fetch(`${BACKEND_URL}/health`, { method: 'GET', mode: 'no-cors' }).catch(() => {});
  ping();
  setInterval(ping, 10 * 60 * 1000);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 15_000,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: 1
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
