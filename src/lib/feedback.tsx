import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  detail?: string;
}

interface FeedbackContextValue {
  notifySuccess: (detail?: string) => void;
  notifyError: (title: string, detail?: string) => void;
  notifyWarning: (title: string, detail?: string) => void;
  notifyInfo: (title: string, detail?: string) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

function playFeedbackTone(variant: ToastVariant) {
  try {
    if (typeof window === 'undefined') return;
    if (navigator.vibrate) {
      navigator.vibrate(variant === 'success' ? [35, 25, 45] : variant === 'error' ? [90, 40, 90] : 30);
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (variant === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.11); // A5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (variant === 'error') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.16);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.23);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.16);
    }
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 350);
  } catch {
    // AudioContext may be blocked prior to gesture; fail silently
  }
}

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (variant: ToastVariant, title: string, detail?: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, variant, title, detail }]);
      playFeedbackTone(variant);
      setTimeout(() => {
        dismiss(id);
      }, 3600);
    },
    [dismiss]
  );

  const notifySuccess = useCallback(
    (detail?: string) => {
      pushToast('success', 'تم بنجاح ✅', detail);
    },
    [pushToast]
  );

  const notifyError = useCallback(
    (title: string, detail?: string) => {
      pushToast('error', title, detail);
    },
    [pushToast]
  );

  const notifyWarning = useCallback(
    (title: string, detail?: string) => {
      pushToast('warning', title, detail);
    },
    [pushToast]
  );

  const notifyInfo = useCallback(
    (title: string, detail?: string) => {
      pushToast('info', title, detail);
    },
    [pushToast]
  );

  return (
    <FeedbackContext.Provider value={{ notifySuccess, notifyError, notifyWarning, notifyInfo }}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[92vw] max-w-md pointer-events-none"
      >
        {toasts.map((toast) => {
          const styles =
            toast.variant === 'success'
              ? 'bg-emerald-700/95 border-[#D4AF37] text-white'
              : toast.variant === 'error'
                ? 'bg-red-700/95 border-red-300 text-white'
                : toast.variant === 'warning'
                  ? 'bg-amber-600/95 border-amber-200 text-white'
                  : 'bg-[#1A365D]/95 border-[#D4AF37] text-white';

          const Icon =
            toast.variant === 'success'
              ? CheckCircle2
              : toast.variant === 'error'
                ? XCircle
                : toast.variant === 'warning'
                  ? AlertTriangle
                  : Info;

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border-2 px-4 py-3 shadow-2xl backdrop-blur-md transition-all duration-200 ${styles}`}
            >
              <Icon className="w-5 h-5 shrink-0 mt-0.5 text-[#FDE68A]" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold leading-snug">{toast.title}</p>
                {toast.detail && (
                  <p className="text-xs text-white/90 mt-0.5 leading-relaxed break-words">
                    {toast.detail}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="p-1 rounded-lg hover:bg-white/15 transition-colors shrink-0"
                aria-label="إغلاق التنبيه"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </FeedbackContext.Provider>
  );
};

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useFeedback must be used within FeedbackProvider');
  }
  return ctx;
}
