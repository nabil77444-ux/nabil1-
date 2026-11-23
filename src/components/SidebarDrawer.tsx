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
    badge?: number;
    visible: boolean;
  }> = [
    { route: 'home', label: 'الشاشة الرئيسية', icon: Home, visible: true },
    { route: 'direct_sale', label: 'البيع المباشر للمستهلك', icon: Zap, visible: true },
    { route: 'electronic_cards', label: 'الكروت الإلكترونية (جملة)', icon: CreditCard, visible: true },
    { route: 'invoices', label: 'الفواتير والكروت الورقية', icon: FileText, visible: true },
    { route: 'sales_list', label: 'المبيعات والتقارير المالية', icon: ShoppingBag, visible: true },
    { route: 'customers', label: 'العملاء والدفتر المحاسبي', icon: Users, visible: true },
    { route: 'packages', label: 'الباقات واستيراد الكروت', icon: Layers, visible: isAdmin },
    { route: 'topup_requests', label: 'طلبات التغذية', icon: Send, visible: true },
    {
      route: 'agents_management',
      label: 'إدارة الوكلاء والعملاء',
      icon: UserCheck,
      visible: isAdmin || isAgent,
    },
    { route: 'reports', label: 'منظومة التقارير (10 تقارير)', icon: BarChart3, visible: true },
    {
      route: 'notifications',
      label: 'مركز الإشعارات',
      icon: Bell,
      badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined,
      visible: true,
    },
    { route: 'settings', label: 'الإعدادات وحول التطبيق', icon: Settings, visible: true },
    { route: 'backup', label: 'النسخ الاحتياطي السحابي', icon: DatabaseBackup, visible: true },
    { route: 'audit_logs', label: 'سجل العمليات (Audit Log)', icon: FileClock, visible: isAdmin },
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
      <aside className="relative z-10 w-[84vw] max-w-[325px] h-[100dvh] bg-white dark:bg-slate-900 border-l-2 border-[#D4AF37] shadow-2xl flex flex-col overflow-hidden">
        {/* Royal Profile Header */}
        <div className="royal-header-3d p-4 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="شعار شبكة طيبة نت"
                  referrerPolicy="no-referrer"
                  className="w-full h-full rounded-full object-cover"
                />
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
              className="w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
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

        {/* Scrollable Navigation Links */}
        <div className="flex-1 overflow-y-auto taibah-scroll p-3 space-y-1">
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
                  className={`w-full min-h-[44px] rounded-xl px-3 py-2 flex items-center justify-between text-sm font-bold transition-colors ${
                    active
                      ? 'bg-[#1A365D] text-white border border-[#D4AF37]'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active ? 'text-[#FDE68A]' : 'text-[#1A365D] dark:text-[#D4AF37]'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#DC2626] text-white text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}

          {/* Biometric Activation + Update 11 App Card + Sign Out */}
          <div className="pt-2.5 mt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <button
              type="button"
              onClick={handleEnrollBiometric}
              className={`w-full min-h-[42px] rounded-xl border px-3 text-xs font-extrabold flex items-center justify-center gap-2 ${
                biometricEnrolled
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  : 'border-[#D4AF37]/70 bg-amber-50 dark:bg-amber-950/30 text-[#1A365D] dark:text-[#FDE68A]'
              }`}
            >
              <Fingerprint className="w-4 h-4" />
              <span>{biometricEnrolled ? 'الدخول بالبصمة والوجه: مُفعّل ✅' : 'تفعيل الدخول بالبصمة / الوجه'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                signOutUser();
              }}
              className="w-full min-h-[42px] rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-400 text-xs font-extrabold flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>

        {/* Official Developer Footer */}
        <footer className="shrink-0 bg-[#0F172A] border-t border-[#D4AF37]/70 px-4 py-2.5 text-center">
          <p className="text-xs font-extrabold text-[#FDE68A]">
            {SUPER_ADMIN_CONFIG.developerCredit}
          </p>
        </footer>
      </aside>
    </div>
  );
};
