import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global resilience guard: prevent transient Firestore offline/quota/assertion or
// native-plugin web-preview promise rejections from crashing the UI or kicking out the user.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = (reason instanceof Error ? reason.message : String(reason || '')).toLowerCase();
    const code =
      reason && typeof reason === 'object' && 'code' in reason
        ? String((reason as { code?: unknown }).code || '').toLowerCase()
        : '';

    const isRecoverableAsyncError =
      code === 'unavailable' ||
      code === 'resource-exhausted' ||
      code === 'failed-precondition' ||
      code === 'cloud/timeout' ||
      msg.includes('could not reach cloud firestore') ||
      msg.includes('client is offline') ||
      msg.includes('quota') ||
      msg.includes('internal assertion failed') ||
      msg.includes('not implemented on web') ||
      msg.includes('plugin is not implemented') ||
      msg.includes('network-request-failed');

    if (isRecoverableAsyncError) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
