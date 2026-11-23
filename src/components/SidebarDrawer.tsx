import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  CreditCard,
  DatabaseBackup,
  FileClock,
  FileText,
  Fingerprint,
  Home,
  Layers,
  LogOut,
  Send,
  Settings,
  ShoppingBag,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import { enrollDeviceBiometric, getSavedBiometricEnrollment } from '../lib/biometric';
import {
  formatYER,
  getRoleArabicLabel,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type AppRoute,
} from '../types/taibah';

interface SidebarDrawerProps {
  open: boolean;
  activeRoute: AppRoute;
  hideNumbers: boolean;
  onClose: () => void;
  onNavigate: (route: AppRoute) => void;
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  open,
  activeRoute,
  hideNumbers,
  onClose,
  onNavigate,
}) => {
  const { profile, unreadNotificationsCount, signOutUser } = useFirebase();
  const { notifySuccess } = useFeedback();
  const [biometricEnrolled, setBiometricEnrolled] = useState(() => !!getSavedBiometricEnrollment());

  if (!open || !profile) return null;

  const isAdmin = profile.role === 'super_admin';
  const isAgent = profile.role === 'agent';

  const navItems: Array<{
    route: AppRoute;
    label: string;
    icon: React.FC<{ className?: string }>;
    iconBg: string;
    badge?: number;
    visible: boolean;
  }> = [
    {
      route: 'home',
      label: 'الشاشة الرئيسية',
      icon: Home,
      iconBg: 'bg-gradient-to-br from-[#1A365D] to-blue-700 text-[#FDE68A]',
      visible: true,
    },
    {
      route: 'direct_sale',
      label: 'البيع المباشر للمستهلك',
      icon: Zap,
      iconBg: 'bg-gradient-to-br from-emerald-500 to-green-700 text-white',
      visible: true,
    },
    {
      route: 'electronic_cards',
      label: 'الكروت الإلكترونية (جملة)',
      icon: CreditCard,
      iconBg: 'bg-gradient-to-br from-blue-600 to-indigo-800 text-white',
      visible: true,
    },
    {
      route: 'invoices',
      label: 'الفواتير والكروت الورقية',
      icon: FileText,
      iconBg: 'bg-gradient-to-br from-indigo-500 to-slate-800 text-[#FDE68A]',
      visible: true,
    },
    {
      route: 'sales_list',
      label: 'المبيعات والتقارير المالية',
      icon: ShoppingBag,
      iconBg: 'bg-gradient-to-br from-amber-500 to-yellow-700 text-white',
      visible: true,
    },
    {
      route: 'customers',
      label: 'العملاء والدفتر المحاسبي',
      icon: Users,
      iconBg: 'bg-gradient-to-br from-teal-500 to-emerald-800 text-white',
      visible: true,
    },
    {
      route: 'packages',
      label: 'الباقات واستيراد الكروت',
      icon: Layers,
      iconBg: 'bg-gradient-to-br from-purple-600 to-violet-800 text-white',
      visible: isAdmin,
    },
    {
      route: 'topup_requests',
      label: 'طلبات التغذية',
      icon: Send,
      iconBg: 'bg-gradient-to-br from-cyan-600 to-blue-800 text-white',
      visible: true,
    },
    {
      route: 'agents_management',
      label: 'إدارة الوكلاء والعملاء',
      icon: UserCheck,
      iconBg: 'bg-gradient-to-br from-sky-600 to-[#1A365D] text-[#FDE68A]',
      visible: isAdmin || isAgent,
    },
    {
      route: 'reports',
      label: isAdmin ? 'منظومة التقارير (10 تقارير)' : 'مركز التقارير الشامل',
      icon: BarChart3,
      iconBg: 'bg-gradient-to-br from-orange-500 to-amber-700 text-white',
      visible: true,
    },
    {
      route: 'notifications',
      label: 'مركز الإشعارات',
      icon: Bell,
      iconBg: 'bg-gradient-to-br from-rose-500 to-red-700 text-white',
      badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined,
      visible: true,
    },
    {
      route: 'settings',
      label: 'الإعدادات وحول التطبيق',
      icon: Settings,
      iconBg: 'bg-gradient-to-br from-slate-600 to-slate-900 text-[#FDE68A]',
      visible: true,
    },
    {
      route: 'backup',
      label: 'النسخ الاحتياطي السحابي',
      icon: DatabaseBackup,
      iconBg: 'bg-gradient-to-br from-emerald-600 to-teal-800 text-white',
      visible: true,
    },
    {
      route: 'audit_logs',
      label: 'سجل العمليات (Audit Log)',
      icon: FileClock,
      iconBg: 'bg-gradient-to-br from-[#B4860B] to-[#1A365D] text-white',
      visible: isAdmin,
    },
  ];

  const handleEnrollBiometric = async () => {
    const result = await enrollDeviceBiometric(profile.uid, profile.phone || profile.email, profile.name);
    if (result.success) {
      setBiometricEnrolled(true);
      notifySuccess(
        result.mode === 'android_biometric'
          ? 'تم تفعيل بصمة الإصبع والوجه عبر Android BiometricPrompt بنجاح ✅'
          : result.mode === 'webauthn'
            ? 'تم تفعيل البصمة / الوجه بنجاح ✅'
            : 'تم تفعيل الدخول السريع والآمن لهذا الجهاز بنجاح ✅'
      );
    }
  };

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/55 transition-opacity"
        aria-hidden="true"
      />

      {/* Drawer Panel (slides from right in RTL) */}
      <aside className="relative z-10 w-[84vw] max-w-[330px] h-[100dvh] bg-white dark:bg-slate-900 border-l-2 border-[#D4AF37] shadow-2xl flex flex-col overflow-hidden">
        {/* Royal Profile Header with Safe Area Top */}
        <div className="royal-header-3d safe-top px-4 pb-3.5 pt-3 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0 shadow-md">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden p-0.5">
                  <img
                    src={TAIBAH_ASSETS.logo}
                    alt="شعار شبكة طيبة نت"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-white truncate">{profile.name}</h2>
                <p className="text-[11px] font-bold text-[#FDE68A]">
                  {getRoleArabicLabel(profile.role)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق القائمة"
              className="w-9 h-9 rounded-full bg-white/15 border border-[#D4AF37]/60 text-white flex items-center justify-center hover:bg-white/25 shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="rounded-xl bg-white/10 border border-[#D4AF37]/50 px-3 py-2 flex items-center justify-between text-xs text-white">
            <span className="font-semibold text-slate-200 tabular-nums">{profile.phone}</span>
            <span className="font-extrabold text-[#FDE68A] tabular-nums">
              الرصيد: {formatYER(profile.balance || 0, hideNumbers)}
            </span>
          </div>
        </div>

        {/* Scrollable Navigation Links with Beautified Colored Icon Badges */}
        <div className="flex-1 overflow-y-auto taibah-scroll p-3 space-y-1.5">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const Icon = item.icon;
              const active = activeRoute === item.route;
              return (
                <button
                  key={item.route}
                  type="button"
                  onClick={() => {
                    onNavigate(item.route);
                    onClose();
                  }}
                  className={`w-full min-h-[46px] rounded-xl px-2.5 py-1.5 flex items-center justify-between text-sm font-bold transition-all ${
                    active
                      ? 'bg-[#1A365D] text-white border-2 border-[#D4AF37] shadow-md'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm border ${
                        active
                          ? 'bg-[#D4AF37] text-[#0F172A] border-[#FDE68A]'
                          : `${item.iconBg} border-white/20`
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#DC2626] text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums shadow-sm">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}

          {/* Biometric Activation + Sign Out */}
          <div className="pt-2.5 mt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <button
              type="button"
              onClick={handleEnrollBiometric}
              className={`w-full min-h-[44px] rounded-xl border px-3 text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm ${
                biometricEnrolled
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  : 'border-[#D4AF37]/70 bg-amber-50 dark:bg-amber-950/30 text-[#1A365D] dark:text-[#FDE68A]'
              }`}
            >
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#D4AF37] to-amber-600 text-[#0F172A] flex items-center justify-center shrink-0">
                <Fingerprint className="w-4 h-4" />
              </span>
              <span>
                {biometricEnrolled ? 'الدخول بالبصمة والوجه: مُفعّل ✅' : 'تفعيل الدخول بالبصمة / الوجه'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                signOutUser();
              }}
              className="w-full min-h-[44px] rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm"
            >
              <span className="w-7 h-7 rounded-lg bg-red-600 text-white flex items-center justify-center shrink-0">
                <LogOut className="w-4 h-4" />
              </span>
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>

        {/* Official Developer Footer with Safe Area Bottom */}
        <footer className="shrink-0 bg-[#0F172A] border-t border-[#D4AF37]/70 safe-bottom px-4 py-2 text-center">
          <p className="text-xs font-extrabold text-[#FDE68A]">
            {SUPER_ADMIN_CONFIG.developerCredit}
          </p>
        </footer>
      </aside>
    </div>
  );
};
