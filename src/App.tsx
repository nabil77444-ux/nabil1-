import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FeedbackProvider, useFeedback } from './lib/feedback';
import { FirebaseProvider, useFirebase } from './contexts/FirebaseContext';
import { SplashScreen } from './components/SplashScreen';
import { AuthScreen } from './components/AuthScreen';
import { HomeScreen } from './components/HomeScreen';
import { SidebarDrawer } from './components/SidebarDrawer';
import { ActiveSubScreen, preloadCoreSubScreens } from './components/SubScreens';
import { UpdatePromptModal } from './components/UpdatePromptModal';
import {
  EXPLICIT_SIGNOUT_EVENT,
  hasActiveSessionUnlocked,
  markActiveSessionUnlocked,
} from './lib/sessionGuard';
import {
  checkForAppUpdate,
  clearUpdateSnooze,
  configureNativeUpdateNotifier,
  consumePendingUpdateDialogIntent,
  hasDeferredUpdate,
  isUpdateSnoozedForCurrentSession,
  listenForUpdateDialogIntent,
  notifyUpdaterReady,
  requestNativeNotificationPermissionOnce,
  subscribeDeferredUpdateChanges,
  type AppUpdateManifest,
} from './services/updaterService';
import type { AppRoute } from './types/taibah';

const THEME_STORAGE_KEY = 'taibah_theme_v1';
const HIDE_NUMBERS_KEY = 'taibah_hide_numbers_v1';

const VALID_ROUTES: AppRoute[] = [
  'home',
  'direct_sale',
  'stock_count',
  'electronic_cards',
  'invoices',
  'customers',
  'packages',
  'topup_requests',
  'agents_management',
  'recall_cards',
  'reports',
  'sales_list',
  'notifications',
  'settings',
  'audit_logs',
  'backup',
];

function isNativePlatformSafe(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function getInitialRoute(): AppRoute {
  try {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get('route') as AppRoute | null;
    if (candidate && VALID_ROUTES.includes(candidate)) {
      return candidate;
    }
  } catch {
    // ignore URL parse issues
  }
  return 'home';
}

const TaibahAppShell: React.FC = () => {
  const {
    authReady,
    profile,
    needsAdminEmailVerification,
    appSettings,
    activeRoute,
    setActiveRoute,
  } = useFirebase();
  const { notifyInfo, notifySuccess } = useFeedback();

  // Persisted in sessionStorage during the active run:
  // - Never locks on blur, visibilitychange, keyboard open, PDF picker, or icon navigation.
  // - Automatically resets to locked ONLY when the app is completely closed and reopened fresh
  //   OR when the user manually taps "تسجيل الخروج".
  const [sessionUnlocked, setSessionUnlocked] = useState<boolean>(() =>
    hasActiveSessionUnlocked()
  );

  // Brief splash cap (max 650ms) so AuthScreen / Workspace appears almost instantaneously
  const [splashCapReached, setSplashCapReached] = useState(false);

  // Global OTA Live Update state (applies to ALL users: client, agent, admin)
  const [availableUpdate, setAvailableUpdate] = useState<{
    manifest: AppUpdateManifest;
    requiresNativeApk: boolean;
  } | null>(null);
  const [deferredUpdate, setDeferredUpdate] = useState<boolean>(() => hasDeferredUpdate());
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [lastUpdateCheckInfo, setLastUpdateCheckInfo] = useState<{
    version?: string;
    buildNumber?: number;
    sourceLabel?: string;
    hasUpdate: boolean;
    checkedAt: number;
    error?: string;
  } | null>(null);
  const updateCheckInFlightRef = useRef(false);

  useEffect(() => {
    return subscribeDeferredUpdateChanges(() => {
      setDeferredUpdate(hasDeferredUpdate());
    });
  }, []);

  const isTextInputFocused = (): boolean => {
    try {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || el.isContentEditable) return true;
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
        return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type);
      }
      return false;
    } catch {
      return false;
    }
  };

  const runUpdateCheck = useCallback(
    async (silent: boolean, ignoreSnooze = false): Promise<void> => {
      // Single-flight lock prevents double-taps & duplicate Toast notifications
      if (updateCheckInFlightRef.current) {
        return;
      }

      // Never touch network or React state while the user is actively typing
      if (silent && isTextInputFocused()) {
        window.setTimeout(() => {
          if (!isTextInputFocused()) {
            void runUpdateCheck(true, ignoreSnooze);
          }
        }, 4000);
        return;
      }

      updateCheckInFlightRef.current = true;
      if (!silent) {
        setIsCheckingUpdate(true);
      }

      try {
        if (!silent || ignoreSnooze) {
          clearUpdateSnooze();
        }
        const result = await checkForAppUpdate({
          apkDownloadUrl: appSettings?.apkDownloadUrl,
          silent,
          canMirrorToFirestore: profile?.role === 'super_admin',
        });

        setLastUpdateCheckInfo({
          version: result.latestCheckedVersion || result.manifest?.version || result.currentVersion,
          buildNumber: result.latestCheckedBuildNumber || result.manifest?.buildNumber,
          sourceLabel: result.checkedSourceLabel || result.manifest?.sourceLabel,
          hasUpdate: result.hasUpdate,
          checkedAt: Date.now(),
          error: result.error,
        });

        if (result.hasUpdate && result.manifest) {
          if (silent && !ignoreSnooze && isUpdateSnoozedForCurrentSession(result.manifest.version)) {
            setDeferredUpdate(true);
            return;
          }
          setAvailableUpdate({
            manifest: result.manifest,
            requiresNativeApk: result.requiresNativeApk,
          });
          if (!silent) {
            const srcSuffix = result.checkedSourceLabel ? ` (${result.checkedSourceLabel})` : '';
            notifyInfo(
              'يتوفر تحديث جديد لتطبيق طيبة نت',
              `الإصدار الجديد: v${result.manifest.version}${srcSuffix}`
            );
          }
        } else if (!silent) {
          if (result.error) {
            notifyInfo('تعذر الاتصال بسيرفر التحديثات', result.error);
          } else {
            const latestVer = result.latestCheckedVersion || result.currentVersion;
            const srcNote = result.checkedSourceLabel ? ` • المصدر: ${result.checkedSourceLabel}` : '';
            notifySuccess(
              `تطبيقك محدّث إلى آخر إصدار (v${result.currentVersion}) — آخر إصدار مفحوص: v${latestVer}${srcNote}`
            );
          }
        }
      } catch {
        if (!silent) {
          notifyInfo('تعذر الاتصال بسيرفر التحديثات', 'يرجى التحقق من الإنترنت والمحاولة مجدداً.');
        }
      } finally {
        updateCheckInFlightRef.current = false;
        if (!silent) {
          setIsCheckingUpdate(false);
        }
      }
    },
    [appSettings?.apkDownloadUrl, notifyInfo, notifySuccess, profile?.role]
  );

  // ONLY lock the session when the user explicitly clicks manual "تسجيل الخروج"
  useEffect(() => {
    const onExplicitSignOut = () => {
      setSessionUnlocked(false);
    };
    window.addEventListener(EXPLICIT_SIGNOUT_EVENT, onExplicitSignOut);
    return () => {
      window.removeEventListener(EXPLICIT_SIGNOUT_EVENT, onExplicitSignOut);
    };
  }, []);

  const isFullyVerifiedSession =
    sessionUnlocked &&
    Boolean(profile?.uid) &&
    !needsAdminEmailVerification &&
    profile?.status === 'active';

  useEffect(() => {
    // 1. Immediately confirm active OTA bundle loaded cleanly (native only)
    try {
      notifyUpdaterReady();
    } catch {
      // non-fatal on web preview
    }

    // 2. Enforce native Android Safe Area (prevent top status bar overlap with WebView)
    if (isNativePlatformSafe()) {
      void import('@capacitor/status-bar')
        .then(({ StatusBar, Style }) => {
          StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
          StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
          StatusBar.setBackgroundColor({ color: '#0F172A' }).catch(() => {});
        })
        .catch(() => {
          // ignore on unsupported environments
        });
    }

    const initial = getInitialRoute();
    if (initial !== 'home') {
      setActiveRoute(initial);
    }
    // Ultra-fast 150ms splash cap so AuthScreen / HomeScreen renders immediately
    const timer = window.setTimeout(() => setSplashCapReached(true), 150);
    return () => {
      window.clearTimeout(timer);
    };
  }, [setActiveRoute]);

  // Preload core sub-screens ONLY after user enters the authenticated workspace (never on AuthScreen!)
  useEffect(() => {
    if (!isFullyVerifiedSession) return;
    const preloadTimer = window.setTimeout(() => preloadCoreSubScreens(), 600);
    return () => window.clearTimeout(preloadTimer);
  }, [isFullyVerifiedSession]);

  // 3. Automatic Silent Update Check + Native WorkManager Background Notifier (ALL users: Admin, Agent, Client)
  useEffect(() => {
    if (!isFullyVerifiedSession) return;

    let cancelled = false;
    const listenerBox: { remove: (() => void) | null } = { remove: null };

    // Configure native Android background WorkManager (checks every 2 hours even when app is closed)
    void configureNativeUpdateNotifier(appSettings?.apkDownloadUrl, true);

    // Gently request POST_NOTIFICATIONS permission once on Android 13+ after first login
    const notifPermTimer = window.setTimeout(() => {
      if (!cancelled) {
        void requestNativeNotificationPermissionOnce();
      }
    }, 1800);

    // If user opened app by tapping a native system update notification, open UpdatePromptModal immediately
    void consumePendingUpdateDialogIntent().then((openedFromNotif) => {
      if (!cancelled && openedFromNotif) {
        void runUpdateCheck(false, true);
      }
    });

    void listenForUpdateDialogIntent(() => {
      if (!cancelled) {
        void runUpdateCheck(false, true);
      }
    }).then((cleanup) => {
      if (cancelled) {
        cleanup?.();
      } else {
        listenerBox.remove = cleanup;
      }
    });

    const initialCheckTimer = window.setTimeout(() => {
      if (!cancelled) void runUpdateCheck(true);
    }, 3000);

    let appStateHandle: { remove: () => Promise<void> } | null = null;
    if (isNativePlatformSafe()) {
      void import('@capacitor/app')
        .then(({ App: CapacitorApp }) => {
          if (cancelled) return;
          return CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (!cancelled && isActive) {
              void runUpdateCheck(true);
            }
          }).then((handle) => {
            if (cancelled) {
              void handle.remove().catch(() => {});
            } else {
              appStateHandle = handle;
            }
          });
        })
        .catch(() => {
          // non-fatal on web preview
        });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(notifPermTimer);
      window.clearTimeout(initialCheckTimer);
      listenerBox.remove?.();
      if (appStateHandle) {
        void appStateHandle.remove().catch(() => {});
      }
    };
  }, [appSettings?.apkDownloadUrl, isFullyVerifiedSession, runUpdateCheck]);

  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'dark') return true;
      if (stored === 'light') return false;
    } catch {
      // ignore
    }
    return false;
  });

  const [hideNumbers, setHideNumbers] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_NUMBERS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Sync dark class to <html> cleanly
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  // Enforce role access guards on route navigation
  const handleNavigate = (nextRoute: AppRoute) => {
    const role = profile?.role;
    const isAdminOrAgent = role === 'super_admin' || role === 'agent';
    if (nextRoute === 'packages' && role !== 'super_admin') {
      notifyInfo('صلاحية الإدارة فقط', 'شاشة إدارة الباقات مخصصة للمدير العام فقط.');
      return;
    }
    if (nextRoute === 'electronic_cards' && !isAdminOrAgent) {
      notifyInfo('صلاحية غير متاحة', 'شاشة الكروت الإلكترونية مخصصة للمدير والوكيل فقط.');
      return;
    }
    if (nextRoute === 'agents_management' && !isAdminOrAgent) {
      notifyInfo('صلاحية غير متاحة', 'شاشة إدارة الوكلاء والعملاء مخصصة للمدير والوكيل.');
      return;
    }
    if (nextRoute === 'recall_cards' && !isAdminOrAgent) {
      notifyInfo('صلاحية غير متاحة', 'شاشة سحب الكروت مخصصة للمدير والوكيل فقط.');
      return;
    }
    if (nextRoute === 'audit_logs' && role !== 'super_admin') {
      notifyInfo('صلاحية الإدارة فقط', 'سجل العمليات الرقابي مخصص للمدير العام فقط.');
      return;
    }
    setActiveRoute(nextRoute);
  };

  const toggleTheme = () => setIsDark((prev) => !prev);

  const toggleHideNumbers = () => {
    setHideNumbers((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HIDE_NUMBERS_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleUnlockSession = useCallback((uid?: string, email?: string) => {
    markActiveSessionUnlocked(uid, email);
    setSessionUnlocked(true);
  }, []);

  const updateModalNode = (
    <UpdatePromptModal
      manifest={availableUpdate?.manifest || null}
      requiresNativeApk={Boolean(availableUpdate?.requiresNativeApk)}
      onDismiss={() => {
        setAvailableUpdate(null);
      }}
    />
  );

  // 1. Brief Splash only while Auth boots (<150ms) and no local session is already active
  if (!authReady && !splashCapReached && !(sessionUnlocked && profile?.uid)) {
    return (
      <>
        <SplashScreen />
        {updateModalNode}
      </>
    );
  }

  // 2. Local-First Authentication Gate:
  if (!isFullyVerifiedSession) {
    return (
      <>
        <AuthScreen
          isDark={isDark}
          onToggleTheme={toggleTheme}
          sessionUnlocked={sessionUnlocked}
          onUnlockSession={handleUnlockSession}
        />
        {updateModalNode}
      </>
    );
  }

  // 3. Authenticated Active Workspace (Sub-screens wrapped in dedicated ErrorBoundary)
  return (
    <>
      {activeRoute === 'home' ? (
        <ErrorBoundary resetKey="home">
          <HomeScreen
            activeRoute={activeRoute}
            onNavigate={handleNavigate}
            onOpenSidebar={() => setSidebarOpen(true)}
            isDark={isDark}
            onToggleTheme={toggleTheme}
            hideNumbers={hideNumbers}
            onToggleHideNumbers={toggleHideNumbers}
            hasDeferredUpdate={deferredUpdate}
          />
        </ErrorBoundary>
      ) : (
        <ActiveSubScreen
          route={activeRoute}
          onBack={() => setActiveRoute('home')}
          onNavigate={handleNavigate}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          hideNumbers={hideNumbers}
          hasDeferredUpdate={deferredUpdate}
          isCheckingUpdate={isCheckingUpdate}
          lastUpdateCheckInfo={lastUpdateCheckInfo}
          onManualCheckUpdate={() => runUpdateCheck(false, true)}
        />
      )}

      <SidebarDrawer
        open={sidebarOpen}
        activeRoute={activeRoute}
        hideNumbers={hideNumbers}
        onClose={() => setSidebarOpen(false)}
        onNavigate={handleNavigate}
      />

      {updateModalNode}
    </>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <FeedbackProvider>
        <FirebaseProvider>
          <TaibahAppShell />
        </FirebaseProvider>
      </FeedbackProvider>
    </ErrorBoundary>
  );
}
