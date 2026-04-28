import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

// Error boundary — shows a friendly error instead of white screen
class ErrorBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err, info) { console.error('[ErrorBoundary]', err, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',padding:'32px',fontFamily:'sans-serif',textAlign:'center' }}>
          <div style={{ fontSize:'48px',marginBottom:'16px' }}>⚠️</div>
          <h2 style={{ color:'#1a2e4a',marginBottom:'8px' }}>Something went wrong</h2>
          <p style={{ color:'#64748b',marginBottom:'24px' }}>The app encountered an error. Please refresh to try again.</p>
          <button onClick={() => { caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))); window.location.reload(); }}
            style={{ padding:'10px 24px',background:'#1a2e4a',color:'white',border:'none',borderRadius:'8px',fontSize:'14px',fontWeight:600,cursor:'pointer' }}>
            Clear Cache &amp; Refresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000 },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              style: { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155' },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
