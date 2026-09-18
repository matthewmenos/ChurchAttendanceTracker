import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import OfflinePage from './pages/OfflinePage.jsx';
import './styles.css';

// Register the PWA service worker (precaches the app shell, runtime-caches
// /api GETs for offline data). autoUpdate keeps ushers on the latest build.
import { registerSW } from 'virtual:pwa-register';
import { PullToRefreshProvider } from './context/PullToRefreshContext.jsx';
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SplashScreen />
        <OfflinePage />
        <AuthProvider>
          <PullToRefreshProvider>
            <App />
          </PullToRefreshProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);