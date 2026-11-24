import React, { useCallback, useEffect, useState } from 'react';
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
  isUpdateSnoozedForCurrentSession,
  notifyUpdaterReady,
  type AppUpdateManifest,
} from './services/updaterService';
import type { AppRoute } from './types/taibah';

const THEME_STORAGE_KEY = 'taibah_theme_v1';
const HIDE_NUMBERS_KEY = 'taibah_hide_numbers_v1';

const VALID_ROUTES: AppRoute[] = [
  'home',
  'direct_sale',
  'electronic_cards',
  'invoices',
  'customers',
  'packages',
  'topup_requests',
  'agents_management',
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

  const runUpdateCheck = useCallback(
    async (silent: boolean) => {
      try {
        const result = await checkForAppUpdate({
          apkDownloadUrl: appSettings?.apkDownloadUrl,
          silent,
        });

        if (result.hasUpdate && result.manifest) {
          if (silent && isUpdateSnoozedForCurrentSession(result.manifest.version)) {
            return;
          }
          setAvailableUpdate({
            manifest: result.manifest,
            requiresNativeApk: result.requiresNativeApk,
          });
        } else if (!silent) {
          if (result.error) {
            notifyInfo('تحديثات التطبيق', result.error);
          } else {
            notifySuccess(`التطبيق محدّث على آخر إصدار (v${result.currentVersion}) ✅`);
          }
        }
      } catch {
        // Non-fatal: never crash app or disturb user on update check failures
      }
    },
    [appSettings?.apkDownloadUrl, notifyInfo, notifySuccess]
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
    const timer = window.setTimeout(() => setSplashCapReached(true), 650);
    const preloadTimer = window.setTimeout(() => preloadCoreSubScreens(), 500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(preloadTimer);
    };
  }, [setActiveRoute]);

  // 3. Silent OTA Update Check on launch + on resume from background (native guarded)
  useEffect(() => {
    if (!isNativePlatformSafe()) return;

    let cancelled = false;
    const initialCheckTimer = window.setTimeout(() => {
      if (!cancelled) void runUpdateCheck(true);
    }, 1800);

    let appStateHandle: { remove: () => Promise<void> } | null = null;
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

    return () => {
      cancelled = true;
      window.clearTimeout(initialCheckTimer);
      if (appStateHandle) {
        void appStateHandle.remove().catch(() => {});
      }
    };
  }, [runUpdateCheck]);

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
    if (nextRoute === 'packages' && role !== 'super_admin') {
      notifyInfo('صلاحية الإدارة فقط', 'شاشة إدارة الباقات مخصصة للمدير العام فقط.');
      return;
    }
    if (nextRoute === 'agents_management' && role === 'client') {
      notifyInfo('صلاحية غير متاحة', 'شاشة إدارة الوكلاء والعملاء مخصصة للمدير والوكيل.');
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

  // 1. Brief Splash only while Auth boots (<650ms) and no local session is already active
  if (!authReady && !splashCapReached && !(sessionUnlocked && profile?.uid)) {
    return (
      <>
        <SplashScreen />
        {updateModalNode}
      </>
    );
  }

  // 2. Local-First Authentication Gate:
  //    - Mandatory on fresh cold start (when sessionStorage is empty)
  //    - Managed exclusively by local `sessionStorage` + `profile` (never kicks out on
  //      Firebase Auth fluctuations, blur, keyboard, PDF picker, or visibilitychange)
  const isFullyVerifiedSession =
    sessionUnlocked &&
    Boolean(profile?.uid) &&
    !needsAdminEmailVerification &&
    profile?.status === 'active';

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
          onManualCheckUpdate={() => void runUpdateCheck(false)}
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
