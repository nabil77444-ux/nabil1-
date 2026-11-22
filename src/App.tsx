import React, { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FeedbackProvider, useFeedback } from './lib/feedback';
import { FirebaseProvider, useFirebase } from './contexts/FirebaseContext';
import { SplashScreen } from './components/SplashScreen';
import { AuthScreen } from './components/AuthScreen';
import { HomeScreen } from './components/HomeScreen';
import { SidebarDrawer } from './components/SidebarDrawer';
import { ActiveSubScreen } from './components/SubScreens';
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
    firebaseUser,
    profile,
    profileLoading,
    needsAdminEmailVerification,
    activeRoute,
    setActiveRoute,
  } = useFirebase();
  const { notifyInfo } = useFeedback();

  // Update 12: Mandatory hard cap of 1200ms max on Splash Screen — NEVER block startup!
  const [splashCapReached, setSplashCapReached] = useState(false);

  useEffect(() => {
    const initial = getInitialRoute();
    if (initial !== 'home') {
      setActiveRoute(initial);
    }
    const timer = window.setTimeout(() => setSplashCapReached(true), 1200);
    return () => window.clearTimeout(timer);
  }, [setActiveRoute]);

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

  // 1. Instant Boot (Update 12): If cached active profile exists, render immediately (<0.5s).
  // Otherwise show Splash for AT MOST 1200ms while Firebase Auth/Firestore settles silently.
  const hasCachedActiveSession = profile && profile.status === 'active' && !needsAdminEmailVerification;
  const stillInitializing = !authReady || (firebaseUser && profileLoading && !profile);

  if (!hasCachedActiveSession && stillInitializing && !splashCapReached) {
    return <SplashScreen />;
  }

  // 2. Authentication, Email Verification, or Pending Approval Gate
  if (
    (!hasCachedActiveSession && !firebaseUser) ||
    needsAdminEmailVerification ||
    !profile ||
    profile.status !== 'active'
  ) {
    return <AuthScreen isDark={isDark} onToggleTheme={toggleTheme} />;
  }

  // 3. Authenticated Active Workspace
  return (
    <>
      {activeRoute === 'home' ? (
        <HomeScreen
          activeRoute={activeRoute}
          onNavigate={handleNavigate}
          onOpenSidebar={() => setSidebarOpen(true)}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          hideNumbers={hideNumbers}
          onToggleHideNumbers={toggleHideNumbers}
        />
      ) : (
        <ActiveSubScreen
          route={activeRoute}
          onBack={() => setActiveRoute('home')}
          onNavigate={handleNavigate}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          hideNumbers={hideNumbers}
        />
      )}

      <SidebarDrawer
        open={sidebarOpen}
        activeRoute={activeRoute}
        hideNumbers={hideNumbers}
        onClose={() => setSidebarOpen(false)}
        onNavigate={handleNavigate}
      />
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
