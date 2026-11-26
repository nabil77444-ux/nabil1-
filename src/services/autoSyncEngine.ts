import { Capacitor } from '@capacitor/core';

/**
 * Zero-Touch Continuous Auto-Sync Engine (`autoSyncEngine.ts`) for TAIBAH NET.
 *
 * Guarantees:
 * 1. Instant reconnect trigger (`window.online` + `@capacitor/network` listener) within < 1s.
 * 2. App resume / foreground trigger (`visibilitychange`, `window.focus`, `@capacitor/app`).
 * 3. Immediate post-mutation trigger (`notifyLocalMutation()`) right after every sale/topup/ledger write.
 * 4. Continuous Watchdog Heartbeat:
 *    - Every 15 seconds while ANY pending operation exists in offline queues (strict FIFO flush).
 *    - Every 90 seconds lightweight consistency verification while online & idle.
 * 5. Single-Flight Lock so two sync cycles NEVER collide or overlap.
 * 6. Typing-Idle Guard: defers background sync start by 1s while user is typing in any input field
 *    so typing stays 60fps with zero jank on low-end Android devices.
 */

export type AutoSyncVisualState = 'synced' | 'syncing' | 'offline_saved';

export interface AutoSyncSnapshot {
  state: AutoSyncVisualState;
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: number | null;
}

export interface AutoSyncCallbacks {
  getPendingCount: () => number;
  flushPendingQueue: () => Promise<{ syncedCount: number; remainingCount: number }>;
  verifyConsistencyLight: () => Promise<void>;
  onNetworkStateChange?: (online: boolean) => void;
}

type SnapshotListener = (snapshot: AutoSyncSnapshot) => void;

const PENDING_WATCHDOG_MS = 15_000;
const HEALTHY_HEARTBEAT_MS = 90_000;
const TYPING_DEFER_MS = 1_000;
const RECONNECT_DEBOUNCE_MS = 350;

function isNativePlatformSafe(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function isUserActivelyTyping(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || el.isContentEditable) return true;
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range'].includes(type);
    }
    return false;
  } catch {
    return false;
  }
}

class TaibahAutoSyncEngine {
  private started = false;
  private callbacks: AutoSyncCallbacks | null = null;
  private listeners = new Set<SnapshotListener>();

  // Single-Flight Lock state
  private inFlight = false;
  private rerunAfterFlight = false;

  // Timers & native handles
  private deferredTimer: number | null = null;
  private pendingWatchdogTimer: number | null = null;
  private healthyHeartbeatTimer: number | null = null;
  private networkPluginHandle: { remove: () => Promise<void> } | null = null;
  private appPluginHandle: { remove: () => Promise<void> } | null = null;

  private lastLightVerifyAt = 0;

  private snapshot: AutoSyncSnapshot = {
    state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline_saved' : 'synced',
    isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    isSyncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
  };

  private computeVisualState(
    isOnline: boolean,
    isSyncing: boolean,
    pendingCount: number
  ): AutoSyncVisualState {
    if (!isOnline) return 'offline_saved';
    if (isSyncing || pendingCount > 0) return 'syncing';
    return 'synced';
  }

  private emit(partial?: Partial<AutoSyncSnapshot>): void {
    const pendingCount =
      partial?.pendingCount !== undefined
        ? partial.pendingCount
        : this.callbacks
          ? this.callbacks.getPendingCount()
          : this.snapshot.pendingCount;
    const isOnline =
      partial?.isOnline !== undefined ? partial.isOnline : this.snapshot.isOnline;
    const isSyncing =
      partial?.isSyncing !== undefined ? partial.isSyncing : this.snapshot.isSyncing;
    const lastSyncedAt =
      partial?.lastSyncedAt !== undefined ? partial.lastSyncedAt : this.snapshot.lastSyncedAt;

    const next: AutoSyncSnapshot = {
      state: this.computeVisualState(isOnline, isSyncing, pendingCount),
      isOnline,
      isSyncing,
      pendingCount,
      lastSyncedAt,
    };

    if (
      next.state === this.snapshot.state &&
      next.isOnline === this.snapshot.isOnline &&
      next.isSyncing === this.snapshot.isSyncing &&
      next.pendingCount === this.snapshot.pendingCount &&
      next.lastSyncedAt === this.snapshot.lastSyncedAt
    ) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  public getSnapshot(): AutoSyncSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handleOnlineEvent = () => {
    this.updateConnectivity(true, true);
  };

  private handleOfflineEvent = () => {
    this.updateConnectivity(false, false);
  };

  private handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.scheduleSync('resume', 250);
    }
  };

  private handleWindowFocus = () => {
    this.scheduleSync('focus', 250);
  };

  private updateConnectivity(online: boolean, triggerSyncImmediately: boolean): void {
    const changed = this.snapshot.isOnline !== online;
    this.emit({ isOnline: online });
    if (changed && this.callbacks?.onNetworkStateChange) {
      try {
        this.callbacks.onNetworkStateChange(online);
      } catch {
        // Non-fatal
      }
    }
    if (online && triggerSyncImmediately) {
      // Trigger sync within < 1s of network restoration
      this.scheduleSync('online', RECONNECT_DEBOUNCE_MS);
    }
  }

  public start(callbacks: AutoSyncCallbacks): void {
    this.callbacks = callbacks;
    const initialOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    this.emit({
      isOnline: initialOnline,
      pendingCount: callbacks.getPendingCount(),
    });

    if (this.started) {
      // Refresh timers & kick off an immediate check if pending items exist
      if (initialOnline && callbacks.getPendingCount() > 0) {
        this.scheduleSync('restart', 300);
      }
      return;
    }

    this.started = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnlineEvent);
      window.addEventListener('offline', this.handleOfflineEvent);
      window.addEventListener('focus', this.handleWindowFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Native Capacitor Network & App lifecycle listeners (if installed & native)
    if (isNativePlatformSafe()) {
      void import('@capacitor/network')
        .then(async ({ Network }) => {
          if (!this.started) return;
          try {
            const status = await Network.getStatus();
            this.updateConnectivity(Boolean(status?.connected), Boolean(status?.connected));
          } catch {
            // ignore
          }
          const handle = await Network.addListener('networkStatusChange', (status) => {
            if (!this.started) return;
            this.updateConnectivity(Boolean(status?.connected), Boolean(status?.connected));
          });
          if (!this.started) {
            void handle.remove().catch(() => {});
          } else {
            this.networkPluginHandle = handle;
          }
        })
        .catch(() => {
          // Fallback cleanly to browser online/offline events
        });

      void import('@capacitor/app')
        .then(async ({ App: CapacitorApp }) => {
          if (!this.started) return;
          const handle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (!this.started || !isActive) return;
            this.scheduleSync('app_resume', 300);
          });
          if (!this.started) {
            void handle.remove().catch(() => {});
          } else {
            this.appPluginHandle = handle;
          }
        })
        .catch(() => {
          // Ignore on unsupported environments
        });
    }

    // Watchdog #1: Rapid 15s FIFO retry loop whenever pending operations exist
    this.pendingWatchdogTimer = window.setInterval(() => {
      if (!this.started || !this.callbacks) return;
      const pending = this.callbacks.getPendingCount();
      this.emit({ pendingCount: pending });
      if (pending > 0) {
        // Attempt flush even if navigator.onLine is uncertain (real probe inside flush)
        this.scheduleSync('pending_watchdog', 0);
      }
    }, PENDING_WATCHDOG_MS);

    // Watchdog #2: Gentle 90s consistency heartbeat when connected & idle
    this.healthyHeartbeatTimer = window.setInterval(() => {
      if (!this.started || !this.callbacks) return;
      if (!this.snapshot.isOnline) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      this.scheduleSync('heartbeat_90s', 0, true);
    }, HEALTHY_HEARTBEAT_MS);

    // Kick off initial background sync shortly after mount
    if (initialOnline) {
      this.scheduleSync('boot', 500);
    }
  }

  public stop(): void {
    this.started = false;
    this.callbacks = null;
    this.rerunAfterFlight = false;

    if (this.deferredTimer !== null) {
      window.clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
    }
    if (this.pendingWatchdogTimer !== null) {
      window.clearInterval(this.pendingWatchdogTimer);
      this.pendingWatchdogTimer = null;
    }
    if (this.healthyHeartbeatTimer !== null) {
      window.clearInterval(this.healthyHeartbeatTimer);
      this.healthyHeartbeatTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnlineEvent);
      window.removeEventListener('offline', this.handleOfflineEvent);
      window.removeEventListener('focus', this.handleWindowFocus);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    if (this.networkPluginHandle) {
      void this.networkPluginHandle.remove().catch(() => {});
      this.networkPluginHandle = null;
    }
    if (this.appPluginHandle) {
      void this.appPluginHandle.remove().catch(() => {});
      this.appPluginHandle = null;
    }
  }

  /**
   * Call immediately after ANY local sale, topup, customer, or ledger mutation.
   * Updates the quiet badge instantaneously and fires background sync if online.
   */
  public notifyLocalMutation(): void {
    const pending = this.callbacks ? this.callbacks.getPendingCount() : this.snapshot.pendingCount;
    const online = typeof navigator === 'undefined' ? this.snapshot.isOnline : navigator.onLine;
    this.emit({ isOnline: online, pendingCount: pending });
    if (online && this.started) {
      // Short 120ms delay ensures current UI frame / modal renders instantaneously at 60fps
      this.scheduleSync('mutation', 120);
    }
  }

  public scheduleSync(reason: string, delayMs = 0, includeLightVerify = false): void {
    if (!this.started || !this.callbacks) return;

    if (this.deferredTimer !== null) {
      window.clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
    }

    const run = () => {
      this.deferredTimer = null;
      if (!this.started || !this.callbacks) return;

      // Typing-Idle Guard: never start a sync cycle while user is actively typing
      if (isUserActivelyTyping() && reason !== 'mutation') {
        this.deferredTimer = window.setTimeout(run, TYPING_DEFER_MS);
        return;
      }

      void this.executeSingleFlight(includeLightVerify);
    };

    if (delayMs > 0) {
      this.deferredTimer = window.setTimeout(run, delayMs);
    } else {
      run();
    }
  }

  public async triggerImmediateFlush(includeLightVerify = false): Promise<void> {
    if (!this.callbacks) return;
    await this.executeSingleFlight(includeLightVerify);
  }

  private async executeSingleFlight(includeLightVerify: boolean): Promise<void> {
    if (!this.callbacks) return;

    if (this.inFlight) {
      this.rerunAfterFlight = true;
      return;
    }

    const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
    const initialPending = this.callbacks.getPendingCount();

    if (!onlineNow && initialPending === 0) {
      this.emit({ isOnline: false, isSyncing: false, pendingCount: 0 });
      return;
    }

    if (!onlineNow && initialPending > 0) {
      this.emit({ isOnline: false, isSyncing: false, pendingCount: initialPending });
      return;
    }

    this.inFlight = true;
    if (initialPending > 0) {
      this.emit({ isOnline: true, isSyncing: true, pendingCount: initialPending });
    }

    try {
      const result = await this.callbacks.flushPendingQueue();
      const remaining =
        typeof result?.remainingCount === 'number'
          ? result.remainingCount
          : this.callbacks.getPendingCount();

      const now = Date.now();
      const shouldVerify =
        includeLightVerify || (result?.syncedCount ?? 0) > 0 || now - this.lastLightVerifyAt >= HEALTHY_HEARTBEAT_MS;

      if (shouldVerify && remaining === 0 && (typeof navigator === 'undefined' || navigator.onLine)) {
        this.lastLightVerifyAt = now;
        try {
          await this.callbacks.verifyConsistencyLight();
        } catch {
          // Non-fatal consistency verify hiccup
        }
      }

      this.emit({
        isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
        isSyncing: false,
        pendingCount: remaining,
        lastSyncedAt: remaining === 0 ? Date.now() : this.snapshot.lastSyncedAt,
      });
    } catch {
      this.emit({
        isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
        isSyncing: false,
        pendingCount: this.callbacks ? this.callbacks.getPendingCount() : 0,
      });
    } finally {
      this.inFlight = false;
      if (this.rerunAfterFlight && this.started) {
        this.rerunAfterFlight = false;
        this.scheduleSync('rerun', 250);
      }
    }
  }
}

export const autoSyncEngine = new TaibahAutoSyncEngine();
