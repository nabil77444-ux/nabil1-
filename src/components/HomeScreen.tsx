import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Eye,
  EyeOff,
  Home,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Send,
  Settings,
  Share2,
  ShoppingBag,
  Sun,
  X,
  Zap,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { shareInstalledAppApk } from '../services/appShareService';
import {
  DEFAULT_HERO_SLIDES,
  formatCount,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type AppRoute,
} from '../types/taibah';

interface HomeScreenProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onOpenSidebar: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  hideNumbers: boolean;
  onToggleHideNumbers: () => void;
  hasDeferredUpdate?: boolean;
}

/**
 * Custom crisp colored 3D Royal SVG Icons (24px–26px inside soft colored containers)
 */
const TileIconArtwork: React.FC<{ route: AppRoute }> = React.memo(({ route }) => {
  switch (route) {
    case 'direct_sale': // سلة تسوق زرقاء بموجات WiFi
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <path d="M18 11a10 10 0 0 1 12 0" fill="none" stroke="#D4AF37" strokeWidth="2.8" strokeLinecap="round" />
          <path d="M21 15a6 6 0 0 1 6 0" fill="none" stroke="#2563EB" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="24" cy="18.2" r="1.8" fill="#1A365D" />
          <path d="M8 19h5l3.5 15h18l3-10H16" fill="#2563EB" fillOpacity="0.18" stroke="#1A365D" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="19" cy="39" r="3" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.5" />
          <circle cx="33" cy="39" r="3" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.5" />
        </svg>
      );
    case 'stock_count': // صناديق مخزون ملكية واضحة وبارزة للوكلاء والعملاء
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <path d="M24 6l16 7.5v21L24 42 8 34.5v-21L24 6z" fill="#DBEAFE" stroke="#1A365D" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M24 6l16 7.5L24 21 8 13.5 24 6z" fill="#2563EB" fillOpacity="0.85" stroke="#1A365D" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M24 21v21" stroke="#1A365D" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M16 9.8l16 7.5" stroke="#FDE68A" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="35" cy="33" r="7" fill="#10B981" stroke="#FFFFFF" strokeWidth="2" />
          <path d="M32 33l2 2.2 4-4.2" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'electronic_cards': // بطاقات زرقاء وذهبية بأيقونة WiFi
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <rect x="6" y="14" width="28" height="20" rx="4" fill="#D4AF37" stroke="#92400E" strokeWidth="1.6" />
          <rect x="13" y="18" width="29" height="20" rx="4" fill="#1A365D" stroke="#D4AF37" strokeWidth="2" />
          <rect x="17" y="23" width="8" height="5" rx="1" fill="#FDE68A" />
          <path d="M29 26a5 5 0 0 1 7 0" fill="none" stroke="#FDE68A" strokeWidth="2" strokeLinecap="round" />
          <path d="M31 29a2.5 2.5 0 0 1 3 0" fill="none" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32.5" cy="32" r="1.3" fill="#FDE68A" />
        </svg>
      );
    case 'invoices': // ورقة فاتورة زرقاء بعلامة $ ذهبية
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <path d="M11 7h22l6 6v28l-4-2.5L31 41l-4-2.5L23 41l-4-2.5L15 41l-4-2.5V7z" fill="#EFF6FF" stroke="#1E40AF" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M33 7v6h6" fill="#BFDBFE" stroke="#1E40AF" strokeWidth="2" strokeLinejoin="round" />
          <line x1="16" y1="18" x2="26" y2="18" stroke="#2563EB" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="16" y1="24" x2="24" y2="24" stroke="#60A5FA" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="31" cy="29" r="7.5" fill="#D4AF37" stroke="#1A365D" strokeWidth="1.8" />
          <text x="31" y="33" textAnchor="middle" fontSize="11" fontWeight="900" fill="#0F172A">$</text>
        </svg>
      );
    case 'customers': // 3 أشخاص أزرق وذهبي
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <circle cx="13" cy="18" r="4.5" fill="#D4AF37" />
          <path d="M6 34c0-4 3-7 7-7s7 3 7 7" fill="#D4AF37" opacity="0.9" />
          <circle cx="35" cy="18" r="4.5" fill="#D4AF37" />
          <path d="M28 34c0-4 3-7 7-7s7 3 7 7" fill="#D4AF37" opacity="0.9" />
          <circle cx="24" cy="15" r="5.5" fill="#1A365D" stroke="#FDE68A" strokeWidth="1.5" />
          <path d="M14 37c0-5.5 4.5-9.5 10-9.5S34 31.5 34 37" fill="#1E40AF" stroke="#D4AF37" strokeWidth="1.8" />
        </svg>
      );
    case 'packages': // صندوق هدية أزرق بشريط ذهبي
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <rect x="9" y="20" width="30" height="20" rx="3" fill="#1E40AF" stroke="#1A365D" strokeWidth="2" />
          <rect x="7" y="14" width="34" height="7" rx="2.5" fill="#2563EB" stroke="#1A365D" strokeWidth="1.8" />
          <rect x="21.5" y="14" width="5" height="26" fill="#D4AF37" />
          <path d="M24 14c-4-7-11-5-10-1s6 2 10 1zm0 0c4-7 11-5 10-1s-6 2-10 1z" fill="#F59E0B" stroke="#92400E" strokeWidth="1.4" />
        </svg>
      );
    case 'topup_requests': // دائرة خضراء بعلامة + بيضاء
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <circle cx="24" cy="24" r="17" fill="#10B981" stroke="#065F46" strokeWidth="2.2" />
          <circle cx="24" cy="24" r="14" fill="none" stroke="#A7F3D0" strokeWidth="1.2" opacity="0.6" />
          <path d="M24 14v20M14 24h20" stroke="#FFFFFF" strokeWidth="4.2" strokeLinecap="round" />
        </svg>
      );
    case 'agents_management': // شخص مدير وشارة زرقاء
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <circle cx="21" cy="15" r="6.5" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.8" />
          <path d="M9 38c0-6.5 5.2-11 12-11s12 4.5 12 11" fill="#1E40AF" stroke="#1A365D" strokeWidth="2" />
          <polygon points="21,27 18.5,33 21,36 23.5,33" fill="#D4AF37" />
          <circle cx="35" cy="31" r="7.5" fill="#2563EB" stroke="#FDE68A" strokeWidth="2" />
          <path d="M32 31l2 2.2 4.2-4.4" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'recall_cards': // بطاقة بسهم استرداد أحمر وذهبي لسحب الكروت غير المباعة
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <rect x="8" y="13" width="30" height="21" rx="4" fill="#FEE2E2" stroke="#1A365D" strokeWidth="2.2" />
          <rect x="8" y="18" width="30" height="5" fill="#1A365D" />
          <rect x="13" y="26" width="10" height="3.5" rx="1.2" fill="#D4AF37" />
          <circle cx="34" cy="31" r="9" fill="#DC2626" stroke="#FDE68A" strokeWidth="2" />
          <path d="M30.5 29.5A4.6 4.6 0 1 1 31 34" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M29.2 26.5v3.6h3.6" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default: // التقارير — أعمدة زرقاء وسهم صاعد برتقالي
      return (
        <svg viewBox="0 0 48 48" className="w-6 h-6 sm:w-[26px] sm:h-[26px] shrink-0 drop-shadow-xs" aria-hidden="true">
          <rect x="8" y="28" width="7" height="12" rx="1.8" fill="#60A5FA" stroke="#1E40AF" strokeWidth="1.5" />
          <rect x="19" y="21" width="7" height="19" rx="1.8" fill="#2563EB" stroke="#1A365D" strokeWidth="1.5" />
          <rect x="30" y="15" width="7" height="25" rx="1.8" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.5" />
          <path d="M8 22l11-8 7 4 12-10" fill="none" stroke="#F97316" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M32 8h6v6" fill="none" stroke="#F97316" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
});
TileIconArtwork.displayName = 'TileIconArtwork';

interface GridTileItem {
  number: number;
  route: AppRoute;
  title: string;
  iconBg: string;
  badgeCount?: number;
  badgeVariant?: 'red' | 'emerald';
  visible: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = React.memo(({
  activeRoute,
  onNavigate,
  onOpenSidebar,
  isDark,
  onToggleTheme,
  hideNumbers,
  onToggleHideNumbers,
  hasDeferredUpdate = false,
}) => {
  const {
    profile,
    packages,
    isOnline,
    firestoreConnected,
    isSyncing,
    pendingOfflineSyncCount,
    autoSyncStatus,
    totalAvailableCards,
    personalStockSplit,
    unreadNotificationsCount,
    pendingRegistrations,
    pendingTopups,
    pendingPasswordResets,
    appSettings,
    signOutUser,
    openTopupForPackage,
  } = useFirebase();
  const { notifySuccess, notifyInfo } = useFeedback();

  const slides = useMemo(() => {
    const custom = appSettings.sliderSlides;
    return custom && custom.length > 0 ? custom : DEFAULT_HERO_SLIDES;
  }, [appSettings.sliderSlides]);

  const sliderEnabled = appSettings.sliderEnabled !== false && slides.length > 0;
  const sliderIntervalMs = Math.max(2, Math.min(30, Number(appSettings.sliderSpeed ?? 5))) * 1000;
  const tickerEnabled = appSettings.newsTickerEnabled !== false && Boolean(appSettings.newsTicker?.trim());
  const tickerDurationSec = Math.max(6, Math.min(90, Number(appSettings.newsTickerSpeed ?? 22)));

  const [slideIndex, setSlideIndex] = useState(0);
  const [warningDismissed, setWarningDismissed] = useState(false);

  useEffect(() => {
    if (!sliderEnabled || slides.length <= 1) return;
    setSlideIndex((prev) => (prev >= slides.length ? 0 : prev));
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, sliderIntervalMs);
    return () => window.clearInterval(timer);
  }, [sliderEnabled, slides.length, sliderIntervalMs]);

  const role = profile?.role || 'client';
  const isConnected = isOnline && firestoreConnected;
  const isLowStock = totalAvailableCards <= (appSettings.lowStockThreshold ?? 20);
  const lowestPackage = useMemo(() => {
    if (!packages || packages.length === 0) return null;
    const lowList = packages.filter((p) => Number(p.availableCount ?? 0) < 10);
    if (lowList.length === 0) return null;
    return [...lowList].sort(
      (a, b) => Number(a.availableCount ?? 0) - Number(b.availableCount ?? 0)
    )[0];
  }, [packages]);
  const agentsBadgeTotal =
    pendingRegistrations.length + (role === 'super_admin' ? pendingPasswordResets.length : 0);
  const personalGrandStockTotal =
    personalStockSplit.totalElectronic + personalStockSplit.totalPaper;

  const tiles = useMemo<GridTileItem[]>(() => {
    const isAdminUser = role === 'super_admin';
    const isAgentUser = role === 'agent';
    const canManageWholesale = isAdminUser || isAgentUser;
    const raw: Array<Omit<GridTileItem, 'number'>> = [
      {
        route: 'direct_sale',
        title: 'البيع المباشر',
        iconBg: 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/70',
        visible: true,
      },
      {
        route: 'stock_count',
        title: 'عدد المخزون',
        iconBg: 'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800/70',
        badgeCount: personalGrandStockTotal,
        badgeVariant: personalGrandStockTotal === 0 ? 'red' : 'emerald',
        visible: !isAdminUser,
      },
      {
        route: 'electronic_cards',
        title: 'الكروت الإلكترونية',
        iconBg: 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800/70',
        badgeCount: totalAvailableCards,
        badgeVariant: totalAvailableCards === 0 ? 'red' : 'emerald',
        visible: canManageWholesale,
      },
      {
        route: 'invoices',
        title: 'الفواتير',
        iconBg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60',
        visible: true,
      },
      {
        route: 'customers',
        title: 'العملاء',
        iconBg: 'bg-teal-50 dark:bg-teal-950/50 border-teal-200 dark:border-teal-800/70',
        visible: true,
      },
      {
        route: 'packages',
        title: 'الباقات',
        iconBg: 'bg-violet-50 dark:bg-violet-950/50 border-violet-200 dark:border-violet-800/70',
        visible: isAdminUser,
      },
      {
        route: 'topup_requests',
        title: 'طلبات التغذية',
        iconBg: 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/70',
        badgeCount: pendingTopups.length > 0 ? pendingTopups.length : undefined,
        badgeVariant: 'red',
        visible: true,
      },
      {
        route: 'agents_management',
        title: 'الوكلاء والعملاء',
        iconBg: 'bg-cyan-50 dark:bg-cyan-950/50 border-cyan-200 dark:border-cyan-800/70',
        badgeCount: agentsBadgeTotal > 0 ? agentsBadgeTotal : undefined,
        badgeVariant: 'red',
        visible: canManageWholesale,
      },
      {
        route: 'recall_cards',
        title: 'سحب الكروت',
        iconBg: 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/70',
        visible: canManageWholesale,
      },
      {
        route: 'reports',
        title: 'التقارير',
        iconBg: 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800/70',
        visible: true,
      },
    ];
    // Strict sequential numbering (1, 2, 3, 4, 5...) with ZERO gaps for every role
    return raw
      .filter((item) => item.visible)
      .map((item, idx) => ({
        ...item,
        number: idx + 1,
      }));
  }, [agentsBadgeTotal, pendingTopups.length, personalGrandStockTotal, role, totalAvailableCards]);

  const handleShareApp = async () => {
    const res = await shareInstalledAppApk({
      description: appSettings.appDescription,
      apkUrl: appSettings.apkDownloadUrl,
    });
    if (res.ok) {
      notifySuccess(res.message);
    } else if (res.mode === 'cancelled') {
      notifyInfo(res.message);
    }
  };

  return (
    <div
      dir="rtl"
      className="taibah-app-frame h-[100dvh] w-full overflow-hidden flex flex-col bg-slate-100 dark:bg-[#0B1220] text-slate-900 dark:text-slate-100 select-none"
    >
      {/* 1. TOP ROYAL HEADER with Safe Area Top Inset */}
      <header className="royal-header-3d safe-top shrink-0 px-3 z-20 border-b-2 border-[#D4AF37]">
        <div className="py-1.5 flex items-center justify-between gap-2">
          {/* Right (RTL): Uncropped Circular Official Logo with Gold Border */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="flex items-center shrink-0 focus-visible:outline-none"
            aria-label="الشاشة الرئيسية"
          >
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg shrink-0">
              <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-0.5">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="شعار شبكة طيبة نت"
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-contain"
                />
              </div>
            </div>
          </button>

          {/* Center: Official Brand Title & Subtitle */}
          <div className="flex-1 min-w-0 text-center">
            <h1 className="text-[15px] sm:text-lg font-extrabold text-white truncate leading-tight">
              كروت طيبة نت
            </h1>
            <p className="text-[11px] sm:text-xs font-bold text-[#FDE68A] truncate">
              — شبكة طيبة نت - {SUPER_ADMIN_CONFIG.name} —
            </p>
          </div>

          {/* Left: Circular Settings Button with Optional Deferred Update Dot */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              aria-label="الإعدادات"
              className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-b from-white/20 to-white/10 hover:from-white/30 hover:to-white/15 border-2 border-[#D4AF37] text-[#FDE68A] flex items-center justify-center active:scale-95 transition-transform shrink-0 shadow-md"
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              {hasDeferredUpdate && (
                <span
                  aria-label="تحديث متوفر"
                  className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-[#0F172A] animate-pulse shadow"
                />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 2. BEAUTIFIED QUICK UTILITY TOOLBAR */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-2.5 py-1.5 flex items-center justify-between gap-1 shadow-sm">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="القائمة الجانبية"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-[#1A365D] to-[#0F172A] border border-[#D4AF37]/80 text-[#FDE68A] flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            <Menu className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            aria-label="جرس الإشعارات"
            className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/50 dark:to-amber-900/30 border border-amber-400/70 text-amber-700 dark:text-[#FDE68A] flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-extrabold flex items-center justify-center shadow tabular-nums">
                {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          {/* Quiet, calm Zero-Touch Auto-Sync Status Indicator (no manual sync prompts) */}
          {(() => {
            const offlineNow = !isOnline || autoSyncStatus.state === 'offline_saved';
            const savingNow =
              !offlineNow &&
              (isSyncing || autoSyncStatus.state === 'syncing' || pendingOfflineSyncCount > 0);
            const liveSynced = !offlineNow && !savingNow && isConnected;
            return (
              <div
                role="status"
                aria-live="polite"
                className={`h-8 sm:h-9 px-2.5 rounded-xl border text-[11px] font-extrabold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap select-none ${
                  offlineNow
                    ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-500/70 text-amber-800 dark:text-amber-200'
                    : savingNow
                      ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-400/70 text-blue-800 dark:text-blue-200'
                      : liveSynced
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/60 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-50 dark:bg-slate-800/70 border-slate-300/70 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {savingNow ? (
                  <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin text-blue-600 dark:text-blue-300" />
                ) : offlineNow ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                ) : (
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                )}
                <span className="tabular-nums">
                  {offlineNow
                    ? pendingOfflineSyncCount > 0
                      ? `وضع أوفلاين • محفوظ تلقائياً (${pendingOfflineSyncCount})`
                      : 'وضع أوفلاين • محفوظ تلقائياً'
                    : savingNow
                      ? pendingOfflineSyncCount > 0
                        ? `جاري الحفظ تلقائياً (${pendingOfflineSyncCount})...`
                        : 'جاري الحفظ تلقائياً...'
                      : 'متصل'}
                </span>
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleHideNumbers}
            title={hideNumbers ? 'إظهار الأرقام' : 'إخفاء الأرقام'}
            aria-label={hideNumbers ? 'إظهار الأرقام' : 'إخفاء الأرقام'}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-300/70 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            {hideNumbers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
            aria-label={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-50 dark:bg-slate-800 border border-amber-300/80 dark:border-[#D4AF37]/60 text-amber-600 dark:text-[#FDE68A] flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={handleShareApp}
            title="مشاركة التطبيق"
            aria-label="مشاركة التطبيق"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-300/80 dark:border-blue-700 text-blue-700 dark:text-blue-300 flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={signOutUser}
            title="تسجيل الخروج"
            aria-label="تسجيل الخروج"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300/80 dark:border-red-900/60 text-red-600 dark:text-red-400 flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MAIN CONTENT BODY — Strictly 100% Viewport Fitted with Balanced 4-Sided Margins (ZERO SCROLL!) */}
      <main className="flex-1 min-h-0 flex flex-col w-full max-w-5xl mx-auto px-3 pt-2 pb-2 gap-1.5 overflow-hidden safe-x">
        {/* 3. CONFIGURABLE HERO SLIDER (Compact proportioned height to keep 100% zero scroll with vertical tiles) */}
        {sliderEnabled && (
          <section
            aria-label="معرض راوتر MikroTik وشبكة طيبة نت"
            className="relative shrink-0 h-[14vh] min-h-[82px] max-h-[136px] sm:h-[16.5vh] rounded-2xl overflow-hidden border-2 border-[#D4AF37] shadow-lg bg-[#0F172A]"
          >
            {slides.map((slide, idx) => (
              <div
                key={slide.id || idx}
                className={`absolute inset-0 transition-opacity duration-500 ${
                  idx === slideIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
                }`}
              >
                <img
                  src={slide.image || TAIBAH_ASSETS.slideMikrotik}
                  alt={slide.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-l from-[#0F172A]/90 via-[#0F172A]/45 to-transparent" />
                <div className="absolute inset-y-0 right-0 flex flex-col justify-center pr-3.5 pl-12 max-w-[85%]">
                  <h2 className="text-sm sm:text-lg font-extrabold text-white leading-snug drop-shadow">
                    {slide.title}
                  </h2>
                  <p className="text-[11px] sm:text-xs font-semibold text-[#FDE68A] mt-0.5 line-clamp-1">
                    {slide.subtitle}
                  </p>
                </div>
              </div>
            ))}

            {slides.length > 1 && (
              <div className="absolute bottom-2 left-3 z-20 flex items-center gap-1.5">
                {slides.map((s, idx) => (
                  <button
                    key={s.id || idx}
                    type="button"
                    onClick={() => setSlideIndex(idx)}
                    aria-label={`الشريحة ${idx + 1}`}
                    className={`h-2 rounded-full transition-all ${
                      idx === slideIndex ? 'w-5 bg-[#D4AF37]' : 'w-2 bg-white/50 hover:bg-white/80'
                    }`}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* 4. CONFIGURABLE GOLD-BORDERED NEWS TICKER + ISOLATED STOCK STATUS BAR */}
        <section className="shrink-0 flex flex-col gap-1">
          {tickerEnabled && (
            <div className="h-7 rounded-xl bg-[#1A365D] dark:bg-slate-900 border-2 border-[#D4AF37] flex items-center overflow-hidden shadow-sm">
              <span className="shrink-0 h-full px-2.5 bg-gradient-to-b from-[#F59E0B] to-[#D4AF37] text-[#0F172A] text-[10.5px] font-extrabold flex items-center gap-1">
                <Bell className="w-3 h-3" />
                أخبار
              </span>
              <div className="flex-1 overflow-hidden px-2">
                <div
                  className="animate-marquee-rtl text-[11.5px] font-bold text-white"
                  style={{ ['--marquee-duration' as string]: `${tickerDurationSec}s` }}
                >
                  {appSettings.newsTicker}
                </div>
              </div>
            </div>
          )}

          {!warningDismissed && (
            <div
              className={`h-7 rounded-xl pr-2.5 pl-1 border flex items-center justify-between gap-1 text-[11.5px] font-bold transition-colors ${
                role === 'super_admin' && pendingTopups.length > 0
                  ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-500 text-amber-900 dark:text-amber-200'
                  : isLowStock || Boolean(lowestPackage)
                    ? 'bg-red-50 dark:bg-red-950/50 border-red-400/80 text-red-700 dark:text-red-300'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/60 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (role === 'super_admin' && pendingTopups.length > 0) {
                    onNavigate('topup_requests');
                  } else if (role !== 'super_admin' && lowestPackage) {
                    openTopupForPackage(lowestPackage.id);
                  } else {
                    onNavigate(role === 'super_admin' ? 'packages' : 'stock_count');
                  }
                }}
                className="flex-1 min-w-0 flex items-center gap-1.5 text-right truncate"
              >
                {role === 'super_admin' && pendingTopups.length > 0 ? (
                  <Bell className="w-3.5 h-3.5 shrink-0 text-red-600 dark:text-amber-300" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate tabular-nums">
                  {role === 'super_admin'
                    ? pendingTopups.length > 0
                      ? `طلبات تغذية جديدة بانتظار التنفيذ (${pendingTopups.length}) — اضغط للعرض`
                      : isLowStock
                        ? `تحذير المخزن: المتبقي (${formatCount(totalAvailableCards, hideNumbers)} كرت)`
                        : `حالة المخزن: المتبقي (${formatCount(totalAvailableCards, hideNumbers)} كرت)`
                    : lowestPackage
                      ? `تنبيه نقص باقة ${lowestPackage.price} (${formatCount(lowestPackage.availableCount, hideNumbers)} كرت) — اضغط لطلب تغذية`
                      : isLowStock
                        ? `مخزون حسابك منخفض: المتبقي (${formatCount(totalAvailableCards, hideNumbers)} كرت)`
                        : pendingTopups.length > 0
                          ? `رصيدك (${formatCount(totalAvailableCards, hideNumbers)} كرت) • لديك ${pendingTopups.length} طلب تغذية معلق`
                          : `رصيد الكروت المتاحة بحسابك: (${formatCount(totalAvailableCards, hideNumbers)} كرت)`}
                </span>
              </button>
              {role !== 'super_admin' && lowestPackage && (
                <button
                  type="button"
                  onClick={() => openTopupForPackage(lowestPackage.id)}
                  className="shrink-0 px-2 py-0.5 rounded-lg bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37]/80 text-[10.5px] font-extrabold whitespace-nowrap"
                >
                  اطلب تغذية
                </button>
              )}
              <button
                type="button"
                onClick={() => setWarningDismissed(true)}
                aria-label="إغلاق شريط التنبيه"
                className="w-6 h-6 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </section>

        {/* 5. SEQUENTIAL VERTICAL-CENTERED ROYAL GRID (ZERO SCROLL — 100% FIT ON EVERY SCREEN!) */}
        <section
          aria-label="الأيقونات الرئيسية"
          className={`flex-1 min-h-0 grid auto-rows-fr ${
            tiles.length >= 9
              ? 'grid-cols-3 gap-2 sm:gap-2.5'
              : tiles.length <= 6
                ? 'grid-cols-2 md:grid-cols-3 gap-3'
                : 'grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5'
          } py-0.5 px-0.5`}
        >
          {tiles.map((tile, idx) => {
            const isThreeCol = tiles.length >= 9;
            const isOddLast = !isThreeCol && tiles.length % 2 === 1 && idx === tiles.length - 1;
            const spaciousMode = tiles.length <= 6;
            return (
              <button
                key={tile.route}
                type="button"
                onClick={() => onNavigate(tile.route)}
                className={`royal-tile-3d relative w-full h-full min-h-0 rounded-2xl bg-gradient-to-b from-white via-white to-slate-50 dark:from-slate-900 dark:via-slate-900 dark:to-[#0F172A] border-2 border-[#D4AF37] flex flex-col items-center justify-center text-center overflow-hidden group ${
                  spaciousMode
                    ? 'gap-2.5 py-3 px-3'
                    : isThreeCol
                      ? 'gap-1.5 py-2 px-1.5 sm:px-2.5'
                      : 'gap-1 sm:gap-2 py-1.5 sm:py-3 px-2.5'
                } ${isOddLast ? 'col-span-2 md:col-span-1' : ''}`}
              >
                {/* Top-Right Corner: Sleek Sequential Number Badge (1, 2, 3...) */}
                <span className="absolute top-1.5 right-1.5 w-5 h-5 sm:w-5.5 sm:h-5.5 rounded-full bg-slate-950 border-[1.5px] border-[#D4AF37] text-[#FDE68A] text-[10px] font-extrabold flex items-center justify-center shadow tabular-nums">
                  {tile.number}
                </span>

                {/* Top-Left Corner: Live Alert / Stock Counter Badge (Zero Overlap) */}
                {tile.badgeCount !== undefined && (
                  <span
                    className={`absolute top-1.5 left-1.5 min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-extrabold flex items-center justify-center shadow tabular-nums border border-white/50 ${
                      tile.badgeVariant === 'emerald'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#DC2626] text-white'
                    }`}
                  >
                    {formatCount(tile.badgeCount, hideNumbers)}
                  </span>
                )}

                {/* Centered Prominent Icon Container */}
                <div
                  className={`${
                    spaciousMode
                      ? 'w-12 h-12'
                      : isThreeCol
                        ? 'w-10 h-10 sm:w-12 sm:h-12'
                        : 'w-10 h-10 sm:w-12 sm:h-12'
                  } rounded-2xl border ${tile.iconBg} flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform`}
                >
                  <TileIconArtwork route={tile.route} />
                </div>

                {/* Centered Bold Arabic Title Matching Icon Proportion */}
                <span
                  className={`w-full text-center font-bold leading-snug text-slate-900 dark:text-white px-0.5 ${
                    isThreeCol ? 'text-[12px] sm:text-[14.5px]' : 'text-[14.5px] sm:text-[15px]'
                  }`}
                >
                  {tile.title}
                </span>
              </button>
            );
          })}
        </section>
      </main>

      {/* 6. FIXED NAVY GOLD-BORDERED BOTTOM NAVIGATION BAR with Safe Area Bottom Clearance */}
      <nav
        aria-label="التنقل السفلي"
        className="shrink-0 bg-[#0F172A] dark:bg-slate-950 border-t-2 border-[#D4AF37] pb-[calc(env(safe-area-inset-bottom,0px)+8px)] z-20"
      >
        <div className="px-2 pt-1 pb-0.5 grid grid-cols-5 items-center gap-1">
          {[
            { route: 'home' as AppRoute, label: 'الرئيسية', icon: Home },
            { route: 'direct_sale' as AppRoute, label: 'البيع المباشر', icon: Zap },
            { route: 'sales_list' as AppRoute, label: 'المبيعات', icon: ShoppingBag },
            { route: 'topup_requests' as AppRoute, label: 'التغذية', icon: Send },
            { route: 'reports' as AppRoute, label: 'التقارير', icon: BarChart3 },
          ].map((navItem) => {
            const Icon = navItem.icon;
            const isActive = activeRoute === navItem.route;
            return (
              <button
                key={navItem.route}
                type="button"
                onClick={() => onNavigate(navItem.route)}
                className={`min-h-[40px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${
                  isActive ? 'text-[#FDE68A] bg-white/10' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 sm:w-[18px] sm:h-[18px] ${isActive ? 'text-[#D4AF37]' : ''}`} />
                <span className="text-[10.5px] sm:text-[11px] font-bold whitespace-nowrap">{navItem.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
});
HomeScreen.displayName = 'HomeScreen';
