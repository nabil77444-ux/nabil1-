import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Reliable Cross-Platform Online Status Hook:
 * - Listens to browser `online` / `offline` events immediately.
 * - On Native Android (Capacitor 7): also subscribes to `@capacitor/network`
 *   `networkStatusChange` so Wi-Fi/cellular transitions trigger automatic background sync
 *   reliably even when Android WebView delays `navigator.onLine`.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    let active = true;
    const handleOnline = () => {
      if (active) setIsOnline(true);
    };
    const handleOffline = () => {
      if (active) setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    let netListener: { remove: () => Promise<void> } | null = null;
    let isNative = false;
    try {
      isNative = Capacitor.isNativePlatform();
    } catch {
      isNative = false;
    }

    if (isNative) {
      void import('@capacitor/network')
        .then(async ({ Network }) => {
          if (!active) return;
          try {
            const status = await Network.getStatus();
            if (active && typeof status?.connected === 'boolean') {
              setIsOnline(status.connected);
            }
          } catch {
            // Non-fatal
          }
          try {
            const handle = await Network.addListener('networkStatusChange', (status) => {
              if (active && typeof status?.connected === 'boolean') {
                setIsOnline(status.connected);
              }
            });
            if (!active) {
              void handle.remove().catch(() => {});
            } else {
              netListener = handle;
            }
          } catch {
            // Non-fatal
          }
        })
        .catch(() => {
          // Non-fatal fallback to navigator.onLine
        });
    }

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (netListener) {
        void netListener.remove().catch(() => {});
      }
    };
  }, []);

  return isOnline;
}
