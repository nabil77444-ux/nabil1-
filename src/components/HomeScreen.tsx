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
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { buildAppShareText } from '../lib/exportUtils';
import { formatCount, SUPER_ADMIN_CONFIG, TAIBAH_ASSETS, type AppRoute } from '../types/taibah';

interface HomeScreenProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onOpenSidebar: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  hideNumbers: boolean;
  onToggleHideNumbers: () => void;
}

/**
 * Custom crisp colored 3D Royal SVG Icons matching Update 2 exact visual specifications:
 * 1. Direct Sale: Blue shopping cart + WiFi waves
 * 2. Electronic Cards: Blue & gold stacked cards + WiFi icon
 * 3. Invoices: Blue invoice paper + gold $
 * 4. Customers: 3 blue & gold people
 * 5. Packages: Blue gift box + gold ribbon
 * 6. Topup Requests: Green circle + white +
 * 7. Agents & Clients: Manager + blue badge
 * 8. Reports: Blue bars + rising orange arrow
 */
const TileIconArtwork: React.FC<{ index: number }> = ({ index }) => {
  switch (index) {
    case 1: // سلة تسوق زرقاء بموجات WiFi
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <path d="M18 11a10 10 0 0 1 12 0" fill="none" stroke="#D4AF37" strokeWidth="2.8" strokeLinecap="round" />
          <path d="M21 15a6 6 0 0 1 6 0" fill="none" stroke="#2563EB" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="24" cy="18.2" r="1.8" fill="#1A365D" />
          <path d="M8 19h5l3.5 15h18l3-10H16" fill="#2563EB" fillOpacity="0.18" stroke="#1A365D" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="19" cy="39" r="3" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.5" />
          <circle cx="33" cy="39" r="3" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.5" />
        </svg>
      );
    case 2: // بطاقات زرقاء وذهبية بأيقونة WiFi
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <rect x="6" y="14" width="28" height="20" rx="4" fill="#D4AF37" stroke="#92400E" strokeWidth="1.6" />
          <rect x="13" y="18" width="29" height="20" rx="4" fill="#1A365D" stroke="#D4AF37" strokeWidth="2" />
          <rect x="17" y="23" width="8" height="5" rx="1" fill="#FDE68A" />
          <path d="M29 26a5 5 0 0 1 7 0" fill="none" stroke="#FDE68A" strokeWidth="2" strokeLinecap="round" />
          <path d="M31 29a2.5 2.5 0 0 1 3 0" fill="none" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32.5" cy="32" r="1.3" fill="#FDE68A" />
        </svg>
      );
    case 3: // ورقة فاتورة زرقاء بعلامة $ ذهبية
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <path d="M11 7h22l6 6v28l-4-2.5L31 41l-4-2.5L23 41l-4-2.5L15 41l-4-2.5V7z" fill="#EFF6FF" stroke="#1E40AF" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M33 7v6h6" fill="#BFDBFE" stroke="#1E40AF" strokeWidth="2" strokeLinejoin="round" />
          <line x1="16" y1="18" x2="26" y2="18" stroke="#2563EB" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="16" y1="24" x2="24" y2="24" stroke="#60A5FA" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="31" cy="29" r="7.5" fill="#D4AF37" stroke="#1A365D" strokeWidth="1.8" />
          <text x="31" y="33" textAnchor="middle" fontSize="11" fontWeight="900" fill="#0F172A">$</text>
        </svg>
      );
    case 4: // 3 أشخاص أزرق وذهبي
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <circle cx="13" cy="18" r="4.5" fill="#D4AF37" />
          <path d="M6 34c0-4 3-7 7-7s7 3 7 7" fill="#D4AF37" opacity="0.9" />
          <circle cx="35" cy="18" r="4.5" fill="#D4AF37" />
          <path d="M28 34c0-4 3-7 7-7s7 3 7 7" fill="#D4AF37" opacity="0.9" />
          <circle cx="24" cy="15" r="5.5" fill="#1A365D" stroke="#FDE68A" strokeWidth="1.5" />
          <path d="M14 37c0-5.5 4.5-9.5 10-9.5S34 31.5 34 37" fill="#1E40AF" stroke="#D4AF37" strokeWidth="1.8" />
        </svg>
      );
    case 5: // صندوق هدية أزرق بشريط ذهبي
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <rect x="9" y="20" width="30" height="20" rx="3" fill="#1E40AF" stroke="#1A365D" strokeWidth="2" />
          <rect x="7" y="14" width="34" height="7" rx="2.5" fill="#2563EB" stroke="#1A365D" strokeWidth="1.8" />
          <rect x="21.5" y="14" width="5" height="26" fill="#D4AF37" />
          <path d="M24 14c-4-7-11-5-10-1s6 2 10 1zm0 0c4-7 11-5 10-1s-6 2-10 1z" fill="#F59E0B" stroke="#92400E" strokeWidth="1.4" />
        </svg>
      );
    case 6: // دائرة خضراء بعلامة + بيضاء
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <circle cx="24" cy="24" r="17" fill="#10B981" stroke="#065F46" strokeWidth="2.2" />
          <circle cx="24" cy="24" r="14" fill="none" stroke="#A7F3D0" strokeWidth="1.2" opacity="0.6" />
          <path d="M24 14v20M14 24h20" stroke="#FFFFFF" strokeWidth="4.2" strokeLinecap="round" />
        </svg>
      );
    case 7: // شخص مدير وشارة زرقاء
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <circle cx="21" cy="15" r="6.5" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.8" />
          <path d="M9 38c0-6.5 5.2-11 12-11s12 4.5 12 11" fill="#1E40AF" stroke="#1A365D" strokeWidth="2" />
          <polygon points="21,27 18.5,33 21,36 23.5,33" fill="#D4AF37" />
          <circle cx="35" cy="31" r="7.5" fill="#2563EB" stroke="#FDE68A" strokeWidth="2" />
          <path d="M32 31l2 2.2 4.2-4.4" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default: // أعمدة زرقاء وسهم صاعد برتقالي
      return (
        <svg viewBox="0 0 48 48" className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 drop-shadow-sm" aria-hidden="true">
          <rect x="8" y="28" width="7" height="12" rx="1.8" fill="#60A5FA" stroke="#1E40AF" strokeWidth="1.5" />
          <rect x="19" y="21" width="7" height="19" rx="1.8" fill="#2563EB" stroke="#1A365D" strokeWidth="1.5" />
          <rect x="30" y="15" width="7" height="25" rx="1.8" fill="#1A365D" stroke="#D4AF37" strokeWidth="1.5" />
          <path d="M8 22l11-8 7 4 12-10" fill="none" stroke="#F97316" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M32 8h6v6" fill="none" stroke="#F97316" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
};

interface GridTileItem {
  number: number;
  route: AppRoute;
  title: string;
  badgeCount?: number;
  badgeVariant?: 'red' | 'emerald';
  visible: boolean;
}

const HERO_SLIDES = [
  {
    id: 'mikrotik',
    image: TAIBAH_ASSETS.slideMikrotik,
    title: 'شبكة طيبة نت اللاسلكية',
    subtitle: 'أنظمة MikroTik عالية الأداء • تغطية سريعة ومستقرة',
  },
  {
    id: 'cards',
    image: TAIBAH_ASSETS.slideCards,
    title: 'كروت إلكترونية وفورية 100%',
    subtitle: 'بيع مباشر وجملة للوكلاء ونقاط البيع بدون أخطاء',
  },
  {
    id: 'agents',
    image: TAIBAH_ASSETS.slideNetwork,
    title: 'إدارة سحابية لحظية للوكلاء',
    subtitle: 'تغذية فورية • تقارير دقيقة • إشعارات حية',
  },
];

export const HomeScreen: React.FC<HomeScreenProps> = ({
  activeRoute,
  onNavigate,
  onOpenSidebar,
  isDark,
  onToggleTheme,
  hideNumbers,
  onToggleHideNumbers,
}) => {
  const {
    profile,
    isOnline,
    firestoreConnected,
    isSyncing,
    totalAvailableCards,
    unreadNotificationsCount,
    pendingRegistrations,
    pendingTopups,
    pendingPasswordResets,
    appSettings,
    syncNow,
    signOutUser,
  } = useFirebase();
  const { notifySuccess, notifyInfo } = useFeedback();

  const [slideIndex, setSlideIndex] = useState(0);
  const [warningDismissed, setWarningDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, []);

  const role = profile?.role || 'client';
  const isConnected = isOnline && firestoreConnected;
  const isLowStock = totalAvailableCards <= (appSettings.lowStockThreshold ?? 20);
  const agentsBadgeTotal = pendingRegistrations.length + (role === 'super_admin' ? pendingPasswordResets.length : 0);

  const tiles = useMemo<GridTileItem[]>(() => {
    const all: GridTileItem[] = [
      {
        number: 1,
        route: 'direct_sale',
        title: 'البيع المباشر',
        visible: true,
      },
      {
        number: 2,
        route: 'electronic_cards',
        title: 'الكروت الإلكترونية',
        badgeCount: totalAvailableCards,
        badgeVariant: totalAvailableCards === 0 ? 'red' : 'emerald',
        visible: true,
      },
      {
        number: 3,
        route: 'invoices',
        title: 'الفواتير',
        visible: true,
      },
      {
        number: 4,
        route: 'customers',
        title: 'العملاء',
        visible: true,
      },
      {
        number: 5,
        route: 'packages',
        title: 'الباقات',
        visible: role === 'super_admin',
      },
      {
        number: 6,
        route: 'topup_requests',
        title: 'طلبات التغذية',
        badgeCount: pendingTopups.length > 0 ? pendingTopups.length : undefined,
        badgeVariant: 'red',
        visible: true,
      },
      {
        number: 7,
        route: 'agents_management',
        title: 'الوكلاء والعملاء',
        badgeCount: agentsBadgeTotal > 0 ? agentsBadgeTotal : undefined,
        badgeVariant: 'red',
        visible: role === 'super_admin' || role === 'agent',
      },
      {
        number: 8,
        route: 'reports',
        title: 'التقارير',
        visible: true,
      },
    ];
    return all.filter((item) => item.visible);
  }, [agentsBadgeTotal, pendingTopups.length, role, totalAvailableCards]);

  const handleShareApp = async () => {
    const shareText = buildAppShareText(appSettings.appDescription);
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'كروت طيبة نت — TAIBAH NET',
          text: shareText,
          url: window.location.origin,
        });
        notifySuccess('تمت مشاركة التطبيق والوصف والرابط المباشر');
      } else {
        await navigator.clipboard.writeText(shareText);
        notifySuccess('تم نسخ نص المشاركة والرابط المباشر إلى الحافظة');
      }
    } catch {
      notifyInfo('تم إلغاء المشاركة');
    }
  };

  return (
    <div
      dir="rtl"
      className="h-[100dvh] w-full overflow-hidden flex flex-col bg-slate-100 dark:bg-[#0B1220] text-slate-900 dark:text-slate-100 select-none"
    >
      {/* 1. TOP ROYAL HEADER — Update 2 Exact Specification */}
      <header className="royal-header-3d shrink-0 px-3 py-2 flex items-center justify-between gap-2 z-20 border-b-2 border-[#D4AF37]">
        {/* Right (RTL): Circular Official Logo with Gold Border */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="flex items-center shrink-0 focus-visible:outline-none"
          aria-label="الشاشة الرئيسية"
        >
          <div className="w-11 h-11 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shadow-lg shrink-0">
            <img
              src={TAIBAH_ASSETS.logo}
              alt="شعار شبكة طيبة نت"
              referrerPolicy="no-referrer"
              className="w-full h-full rounded-full object-cover"
            />
          </div>
        </button>

        {/* Center: Official Brand Title & Subtitle */}
        <div className="flex-1 min-w-0 text-center">
          <h1 className="text-base sm:text-lg font-extrabold text-white truncate leading-tight">
            كروت طيبة نت
          </h1>
          <p className="text-[11px] sm:text-xs font-bold text-[#FDE68A] truncate">
            — شبكة طيبة نت - {SUPER_ADMIN_CONFIG.name} —
          </p>
        </div>

        {/* Left: Circular Settings Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            aria-label="الإعدادات"
            className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 border-2 border-[#D4AF37] text-[#FDE68A] flex items-center justify-center active:scale-95 transition-transform shrink-0 shadow"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 2. QUICK UTILITY TOOLBAR (Right-to-Left per Update 2) */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-2.5 py-1.5 flex items-center justify-between gap-1 shadow-sm">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="القائمة الجانبية"
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#1A365D] dark:text-[#FDE68A] flex items-center justify-center active:scale-95 transition-transform"
          >
            <Menu className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            aria-label="جرس الإشعارات"
            className="relative w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#1A365D] dark:text-white flex items-center justify-center active:scale-95 transition-transform"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-extrabold flex items-center justify-center shadow tabular-nums">
                {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={syncNow}
            disabled={isSyncing}
            className={`h-9 px-2.5 rounded-xl border text-[11px] font-extrabold flex items-center gap-1 transition-colors whitespace-nowrap ${
              isConnected
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/50 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-500/50 text-red-700 dark:text-red-300'
            }`}
          >
            {isConnected ? <Wifi className="w-3.5 h-3.5 shrink-0" /> : <WifiOff className="w-3.5 h-3.5 shrink-0" />}
            <span>{isConnected ? 'متصل ✅' : 'غير متصل'}</span>
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onToggleHideNumbers}
            title={hideNumbers ? 'إظهار الأرقام' : 'إخفاء الأرقام'}
            aria-label={hideNumbers ? 'إظهار الأرقام' : 'إخفاء الأرقام'}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center active:scale-95 transition-transform"
          >
            {hideNumbers ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
            aria-label={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-amber-600 dark:text-[#FDE68A] flex items-center justify-center active:scale-95 transition-transform"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={handleShareApp}
            title="مشاركة التطبيق"
            aria-label="مشاركة التطبيق"
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-blue-700 dark:text-blue-400 flex items-center justify-center active:scale-95 transition-transform"
          >
            <Share2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={signOutUser}
            title="تسجيل الخروج"
            aria-label="تسجيل الخروج"
            className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 flex items-center justify-center active:scale-95 transition-transform"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MAIN CONTENT BODY — Strictly 100% Viewport Fitted (ZERO SCROLL!) */}
      <main className="flex-1 min-h-0 flex flex-col w-full max-w-5xl mx-auto px-2.5 pt-2 pb-1.5 gap-1.5 overflow-hidden">
        {/* 3. MIKROTIK 3-SLIDE GALLERY */}
        <section
          aria-label="معرض راوتر MikroTik وشبكة طيبة نت"
          className="relative shrink-0 h-[14vh] min-h-[88px] max-h-[145px] sm:h-[17vh] rounded-2xl overflow-hidden border-2 border-[#D4AF37] shadow-lg bg-[#0F172A]"
        >
          {HERO_SLIDES.map((slide, idx) => (
            <div
              key={slide.id}
              className={`absolute inset-0 transition-opacity duration-500 ${
                idx === slideIndex ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
              }`}
            >
              <img
                src={slide.image}
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

          <div className="absolute bottom-2 left-3 z-20 flex items-center gap-1.5">
            {HERO_SLIDES.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSlideIndex(idx)}
                aria-label={`الشريحة ${idx + 1}`}
                className={`h-2 rounded-full transition-all ${
                  idx === slideIndex ? 'w-5 bg-[#D4AF37]' : 'w-2 bg-white/50 hover:bg-white/80'
                }`}
              />
            ))}
          </div>
        </section>

        {/* 4. GOLD-BORDERED NEWS TICKER + DISMISSIBLE INVENTORY WARNING BAR */}
        <section className="shrink-0 flex flex-col gap-1">
          <div className="h-7 rounded-xl bg-[#1A365D] dark:bg-slate-900 border-2 border-[#D4AF37] flex items-center overflow-hidden shadow-sm">
            <span className="shrink-0 h-full px-2.5 bg-gradient-to-b from-[#F59E0B] to-[#D4AF37] text-[#0F172A] text-[10px] font-extrabold flex items-center gap-1">
              <Bell className="w-3 h-3" />
              أخبار
            </span>
            <div className="flex-1 overflow-hidden px-2">
              <div className="animate-marquee-rtl text-[11px] font-bold text-white">
                {appSettings.newsTicker}
              </div>
            </div>
          </div>

          {!warningDismissed && (
            <div
              className={`h-7 rounded-xl pr-2.5 pl-1 border flex items-center justify-between text-[11px] font-extrabold transition-colors ${
                isLowStock
                  ? 'bg-red-50 dark:bg-red-950/50 border-red-400/80 text-red-700 dark:text-red-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/60 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <button
                type="button"
                onClick={() => onNavigate(role === 'super_admin' ? 'packages' : 'electronic_cards')}
                className="flex-1 min-w-0 flex items-center gap-1.5 text-right truncate"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate tabular-nums">
                  {isLowStock
                    ? `تحذير المخزن: المتبقي (${formatCount(totalAvailableCards, hideNumbers)} كرت)`
                    : `حالة المخزن: المتبقي (${formatCount(totalAvailableCards, hideNumbers)} كرت)`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setWarningDismissed(true)}
                aria-label="إغلاق شريط تحذير المخزون"
                className="w-6 h-6 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </section>

        {/* 5. THE 8-ICON 3D ROYAL WHITE GOLD-BORDERED GRID (2×4 Mobile, 4×2 Desktop — ZERO SCROLL!) */}
        <section
          aria-label="الأيقونات الرئيسية الثماني"
          className="flex-1 min-h-0 grid grid-cols-2 md:grid-cols-4 auto-rows-fr gap-2 py-0.5"
        >
          {tiles.map((tile) => (
            <button
              key={tile.route}
              type="button"
              onClick={() => onNavigate(tile.route)}
              className="royal-tile-3d relative w-full h-full min-h-0 rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] px-2.5 py-2 flex items-center justify-between gap-1.5 overflow-hidden group"
            >
              {/* Right (RTL): Black circle with gold border number */}
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-slate-950 border-2 border-[#D4AF37] text-[#FDE68A] text-[11px] font-extrabold flex items-center justify-center shadow shrink-0 tabular-nums">
                {tile.number}
              </span>

              {/* Center: Crisp Arabic Title */}
              <span className="flex-1 min-w-0 text-center text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white leading-tight line-clamp-2 px-0.5">
                {tile.title}
              </span>

              {/* Left (RTL): Custom 3D Colored Icon Artwork */}
              <div className="shrink-0 group-hover:scale-105 transition-transform">
                <TileIconArtwork index={tile.number} />
              </div>

              {/* Live Alert / Stock Counter Badge Top-Left */}
              {tile.badgeCount !== undefined && (
                <span
                  className={`absolute top-1 left-1 min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-extrabold flex items-center justify-center shadow tabular-nums ${
                    tile.badgeVariant === 'emerald'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#DC2626] text-white'
                  }`}
                >
                  {formatCount(tile.badgeCount, hideNumbers)}
                </span>
              )}
            </button>
          ))}
        </section>
      </main>

      {/* 6. FIXED NAVY GOLD-BORDERED BOTTOM NAVIGATION BAR (5 ITEMS) */}
      <nav
        aria-label="التنقل السفلي"
        className="shrink-0 bg-[#0F172A] dark:bg-slate-950 border-t-2 border-[#D4AF37] px-1.5 py-1.5 grid grid-cols-5 items-center z-20"
      >
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
              className={`min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all ${
                isActive ? 'text-[#FDE68A] bg-white/10' : 'text-slate-300 hover:text-white'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-[#D4AF37]' : ''}`} />
              <span className="text-[10px] font-extrabold whitespace-nowrap">{navItem.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
