import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BellRing,
  CheckCheck,
  DatabaseBackup,
  FileClock,
  FileText,
  Fingerprint,
  ImagePlus,
  Loader2,
  MessageSquare,
  Moon,
  Newspaper,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sun,
  Trash2,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import {
  clearBiometricEnrollment,
  enrollDeviceBiometric,
  getSavedBiometricEnrollment,
} from '../lib/biometric';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_HERO_SLIDES,
  EXCLUSIVE_PACKAGES,
  formatCount,
  formatDateTimeAr,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type AppRoute,
  type HeroSlideConfig,
} from '../types/taibah';

// Code Splitting — lazy load all heavy operational sub-screens on demand
const SalesListScreen = lazy(() =>
  import('./SalesListScreen').then((m) => ({ default: m.SalesListScreen }))
);
const DirectSaleScreen = lazy(() =>
  import('./DirectSaleScreen').then((m) => ({ default: m.DirectSaleScreen }))
);
const WholesaleCardsScreen = lazy(() =>
  import('./WholesaleCardsScreen').then((m) => ({ default: m.WholesaleCardsScreen }))
);
const CustomersLedgerScreen = lazy(() =>
  import('./CustomersLedgerScreen').then((m) => ({ default: m.CustomersLedgerScreen }))
);
const PackagesImportScreen = lazy(() =>
  import('./PackagesImportScreen').then((m) => ({ default: m.PackagesImportScreen }))
);
const TopupRequestsScreen = lazy(() =>
  import('./TopupRequestsScreen').then((m) => ({ default: m.TopupRequestsScreen }))
);
const AgentsManagementScreen = lazy(() =>
  import('./AgentsManagementScreen').then((m) => ({ default: m.AgentsManagementScreen }))
);
const ReportsCenterScreen = lazy(() =>
  import('./ReportsCenterScreen').then((m) => ({ default: m.ReportsCenterScreen }))
);

const LazyFallback: React.FC = () => (
  <div className="py-16 flex flex-col items-center justify-center gap-2 text-[#1A365D] dark:text-[#FDE68A]">
    <Loader2 className="w-7 h-7 animate-spin" />
    <span className="text-xs font-extrabold">جاري فتح الشاشة...</span>
  </div>
);

/**
 * Compress an uploaded slider image on a canvas to lightweight JPEG DataURL (~35-65 KB)
 * so it stores cleanly in Firestore settings/global without bloating payloads.
 */
async function compressImageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('صيغة الصورة غير صالحة'));
      img.onload = () => {
        const maxW = 720;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas unavailable'));
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

interface SubScreenShellProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  fixedViewport?: boolean;
  children: React.ReactNode;
}

const SubScreenShell: React.FC<SubScreenShellProps> = ({
  title,
  subtitle,
  onBack,
  fixedViewport = false,
  children,
}) => (
  <div
    dir="rtl"
    className={`${
      fixedViewport ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]'
    } w-full flex flex-col bg-slate-100 dark:bg-[#0B1220] text-slate-900 dark:text-slate-100`}
  >
    <header className="sticky top-0 z-30 royal-header-3d safe-top px-3 border-b-2 border-[#D4AF37] shrink-0">
      <div className="py-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="رجوع للشاشة الرئيسية"
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/15 border border-[#D4AF37]/80 text-white flex items-center justify-center active:scale-95 transition-transform shrink-0"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0 text-center">
          <h1 className="text-sm sm:text-base font-extrabold text-white truncate">{title}</h1>
          {subtitle && (
            <p className="text-[10.5px] sm:text-[11px] font-semibold text-[#FDE68A] truncate">
              {subtitle}
            </p>
          )}
        </div>
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0 shadow">
          <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden p-0.5">
            <img
              src={TAIBAH_ASSETS.logo}
              alt="شعار طيبة نت"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      </div>
    </header>

    <main
      className={
        fixedViewport
          ? 'flex-1 min-h-0 w-full max-w-5xl mx-auto px-2.5 py-2 overflow-hidden flex flex-col'
          : 'flex-1 w-full max-w-5xl mx-auto p-3.5 sm:p-5 pb-10'
      }
    >
      {children}
    </main>

    <footer className="shrink-0 bg-[#0F172A] border-t border-[#D4AF37]/60 safe-bottom py-1.5 text-center">
      <span className="text-[11px] font-extrabold text-[#FDE68A]">
        {SUPER_ADMIN_CONFIG.developerCredit}
      </span>
    </footer>
  </div>
);

interface ActiveSubScreenProps {
  route: Exclude<AppRoute, 'home'>;
  onBack: () => void;
  onNavigate: (route: AppRoute) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  hideNumbers: boolean;
}

export const ActiveSubScreen: React.FC<ActiveSubScreenProps> = ({
  route,
  onBack,
  onNavigate,
  isDark,
  onToggleTheme,
  hideNumbers,
}) => {
  const {
    profile,
    packages,
    sales,
    totalAvailableCards,
    notifications,
    managedUsers,
    appSettings,
    auditLogs,
    hasMoreAuditLogs,
    loadMoreAuditLogs,
    markNotificationRead,
    markAllNotificationsRead,
    updateAppSettings,
    enablePushNotifications,
    exportCloudBackup,
  } = useFirebase();
  const { notifySuccess, notifyError } = useFeedback();

  // Settings form state (synced live with appSettings)
  const [newsTicker, setNewsTicker] = useState(appSettings.newsTicker);
  const [newsTickerEnabled, setNewsTickerEnabled] = useState(appSettings.newsTickerEnabled !== false);
  const [newsTickerSpeed, setNewsTickerSpeed] = useState(String(appSettings.newsTickerSpeed ?? 22));
  const [sliderEnabled, setSliderEnabled] = useState(appSettings.sliderEnabled !== false);
  const [sliderSpeed, setSliderSpeed] = useState(String(appSettings.sliderSpeed ?? 5));
  const [sliderSlides, setSliderSlides] = useState<HeroSlideConfig[]>(
    appSettings.sliderSlides && appSettings.sliderSlides.length > 0
      ? appSettings.sliderSlides
      : DEFAULT_HERO_SLIDES
  );
  const [lowStockThreshold, setLowStockThreshold] = useState(String(appSettings.lowStockThreshold));
  const [agentDiscount, setAgentDiscount] = useState(String(appSettings.agentDiscountPercent));
  const [clientDiscount, setClientDiscount] = useState(String(appSettings.clientDiscountPercent));
  const [msgTemplate, setMsgTemplate] = useState(appSettings.directSaleMessageTemplate);
  const [smsTemplate, setSmsTemplate] = useState(
    appSettings.smsMessageTemplate || DEFAULT_APP_SETTINGS.smsMessageTemplate || ''
  );
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    appSettings.whatsappMessageTemplate || DEFAULT_APP_SETTINGS.whatsappMessageTemplate || ''
  );
  const [pdfHeaderTitle, setPdfHeaderTitle] = useState(
    appSettings.pdfHeaderTitle || DEFAULT_APP_SETTINGS.pdfHeaderTitle || ''
  );
  const [pdfHeaderSubtitle, setPdfHeaderSubtitle] = useState(
    appSettings.pdfHeaderSubtitle || DEFAULT_APP_SETTINGS.pdfHeaderSubtitle || ''
  );
  const [pdfFooterText, setPdfFooterText] = useState(
    appSettings.pdfFooterText || DEFAULT_APP_SETTINGS.pdfFooterText || ''
  );
  const [appDescription, setAppDescription] = useState(
    appSettings.appDescription || DEFAULT_APP_SETTINGS.appDescription || ''
  );
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setNewsTicker(appSettings.newsTicker);
    setNewsTickerEnabled(appSettings.newsTickerEnabled !== false);
    setNewsTickerSpeed(String(appSettings.newsTickerSpeed ?? 22));
    setSliderEnabled(appSettings.sliderEnabled !== false);
    setSliderSpeed(String(appSettings.sliderSpeed ?? 5));
    setSliderSlides(
      appSettings.sliderSlides && appSettings.sliderSlides.length > 0
        ? appSettings.sliderSlides
        : DEFAULT_HERO_SLIDES
    );
    setLowStockThreshold(String(appSettings.lowStockThreshold));
    setAgentDiscount(String(appSettings.agentDiscountPercent));
    setClientDiscount(String(appSettings.clientDiscountPercent));
    setMsgTemplate(appSettings.directSaleMessageTemplate);
    setSmsTemplate(appSettings.smsMessageTemplate || DEFAULT_APP_SETTINGS.smsMessageTemplate || '');
    setWhatsappTemplate(
      appSettings.whatsappMessageTemplate || DEFAULT_APP_SETTINGS.whatsappMessageTemplate || ''
    );
    setPdfHeaderTitle(appSettings.pdfHeaderTitle || DEFAULT_APP_SETTINGS.pdfHeaderTitle || '');
    setPdfHeaderSubtitle(
      appSettings.pdfHeaderSubtitle || DEFAULT_APP_SETTINGS.pdfHeaderSubtitle || ''
    );
    setPdfFooterText(appSettings.pdfFooterText || DEFAULT_APP_SETTINGS.pdfFooterText || '');
    setAppDescription(appSettings.appDescription || DEFAULT_APP_SETTINGS.appDescription || '');
  }, [appSettings]);

  const [biometricActive, setBiometricActive] = useState(() => !!getSavedBiometricEnrollment());
  const [auditSearch, setAuditSearch] = useState('');

  const isAdmin = profile?.role === 'super_admin';
  const isAgent = profile?.role === 'agent';

  // Strict route guard for non-admin accounts
  if ((route === 'packages' || route === 'audit_logs') && !isAdmin) {
    onBack();
    return null;
  }
  if (route === 'agents_management' && !isAdmin && !isAgent) {
    onBack();
    return null;
  }

  // =========================================================================
  // DEDICATED OPERATIONAL SCREENS
  // =========================================================================
  if (route === 'sales_list') {
    return (
      <SubScreenShell
        title="المبيعات والتقارير المالية"
        subtitle={`— شبكة طيبة نت - ${SUPER_ADMIN_CONFIG.name} —`}
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <SalesListScreen hideNumbers={hideNumbers} onNavigate={onNavigate} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'direct_sale') {
    return (
      <SubScreenShell
        title="البيع المباشر للمستهلك"
        subtitle="بيع فوري 100% أونلاين وأوفلاين • حماية كاملة من التكرار"
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <DirectSaleScreen hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'electronic_cards') {
    return (
      <SubScreenShell
        title="الكروت الإلكترونية (جملة)"
        subtitle="بيع الجملة والتسعير التلقائي ودعم التسليم على دفعات"
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <WholesaleCardsScreen mode="electronic" hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'invoices') {
    return (
      <SubScreenShell
        title="الفواتير والكروت الورقية"
        subtitle="فواتير ورقية محاسبية مستقلة وطباعة رسمية بالشعار"
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <WholesaleCardsScreen mode="paper" hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'customers') {
    return (
      <SubScreenShell
        title="العملاء والدفتر المحاسبي العام"
        subtitle="حسابات الشبكة والحسابات الخاصة وكشوف الحساب HD"
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <CustomersLedgerScreen hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'packages') {
    return (
      <SubScreenShell
        title="الباقات الثماني واستيراد الكروت"
        subtitle="استيراد فائق السرعة (PDF • Excel • CSV • TXT • OCR)"
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <PackagesImportScreen hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'topup_requests') {
    return (
      <SubScreenShell
        title="طلبات التغذية ثنائية المستوى"
        subtitle="التغذية اللحظية للوكلاء ونقاط البيع"
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <TopupRequestsScreen hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'agents_management') {
    return (
      <SubScreenShell
        title="إدارة الوكلاء والعملاء"
        subtitle="الهرمية • الانضمام الفوري • الترقية والتنزيل والنقل"
        onBack={onBack}
      >
        <Suspense fallback={<LazyFallback />}>
          <AgentsManagementScreen hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  if (route === 'reports') {
    return (
      <SubScreenShell
        title="مركز التقارير الشامل"
        subtitle="تصدير ومشاركة PDF و HD و Excel و SMS وواتساب"
        onBack={onBack}
        fixedViewport
      >
        <Suspense fallback={<LazyFallback />}>
          <ReportsCenterScreen hideNumbers={hideNumbers} />
        </Suspense>
      </SubScreenShell>
    );
  }

  // =========================================================================
  // NOTIFICATIONS CENTER
  // =========================================================================
  if (route === 'notifications') {
    return (
      <SubScreenShell
        title="مركز الإشعارات اللحظي"
        subtitle="مزامنة فورية مع Firebase Firestore و FCM"
        onBack={onBack}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <button
            type="button"
            onClick={enablePushNotifications}
            className="min-h-[42px] px-4 rounded-xl gold-btn-3d text-[#0F172A] text-xs font-extrabold flex items-center gap-2"
          >
            <BellRing className="w-4 h-4" />
            <span>تفعيل الإشعارات الخارجية (FCM)</span>
          </button>
          {notifications.some((n) => !n.isRead) && (
            <button
              type="button"
              onClick={markAllNotificationsRead}
              className="min-h-[42px] px-4 rounded-xl bg-[#1A365D] text-white text-xs font-bold flex items-center gap-1.5"
            >
              <CheckCheck className="w-4 h-4 text-[#FDE68A]" />
              <span>تحديد الكل كمقروء</span>
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/50 p-8 text-center">
            <Bell className="w-10 h-10 mx-auto text-[#D4AF37] mb-3" />
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
              لا توجد إشعارات حالياً (0)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              ستظهر هنا لحظياً جميع طلبات الانضمام، التغذية، المبيعات، الفواتير، وتنبيهات المخزون.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {notifications.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => {
                  if (!notif.isRead) markNotificationRead(notif.id);
                  if (notif.targetRoute && notif.targetRoute !== 'notifications') {
                    onNavigate(notif.targetRoute);
                  }
                }}
                className={`w-full text-right rounded-2xl border-2 p-4 transition-all shadow-sm ${
                  notif.isRead
                    ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 opacity-80'
                    : 'bg-white dark:bg-slate-900 border-[#D4AF37] shadow-md'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {notif.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                      {notif.body}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 tabular-nums">
                      {formatDateTimeAr(notif.createdAt)}
                    </p>
                  </div>
                  {!notif.isRead && (
                    <span className="shrink-0 text-[10px] font-extrabold text-white bg-[#DC2626] px-2 py-0.5 rounded-md">
                      جديد
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </SubScreenShell>
    );
  }

  // =========================================================================
  // SETTINGS & ABOUT APP SCREEN (Strict Role Isolation + Full Admin Controls)
  // =========================================================================
  if (route === 'settings') {
    const handleSlideChange = (idx: number, field: keyof HeroSlideConfig, value: string) => {
      setSliderSlides((prev) =>
        prev.map((slide, i) => (i === idx ? { ...slide, [field]: value } : slide))
      );
    };

    const handleSlideImageUpload = async (idx: number, file?: File) => {
      if (!file) return;
      try {
        const compressed = await compressImageFileToDataUrl(file);
        handleSlideChange(idx, 'image', compressed);
        notifySuccess('تم تجهيز وضغط صورة الشريحة بنجاح ✅');
      } catch {
        notifyError('تعذر تحميل الصورة', 'يرجى اختيار صورة بصيغة JPG أو PNG.');
      }
    };

    const handleAddSlide = () => {
      if (sliderSlides.length >= 6) {
        notifyError('الحد الأقصى 6 شرائح في السلايدر');
        return;
      }
      setSliderSlides((prev) => [
        ...prev,
        {
          id: `slide_${Date.now()}`,
          image: TAIBAH_ASSETS.slideMikrotik,
          title: 'عرض جديد من شبكة طيبة نت',
          subtitle: 'أفضل سرعة وتغطية لاسلكية على مدار الساعة',
        },
      ]);
    };

    const handleRemoveSlide = (idx: number) => {
      setSliderSlides((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleSaveSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      setSavingSettings(true);
      try {
        await updateAppSettings({
          newsTicker,
          newsTickerEnabled,
          newsTickerSpeed: Math.max(6, Math.min(90, Number(newsTickerSpeed) || 22)),
          sliderEnabled,
          sliderSpeed: Math.max(2, Math.min(30, Number(sliderSpeed) || 5)),
          sliderSlides,
          lowStockThreshold: Number(lowStockThreshold) || 0,
          agentDiscountPercent: Number(agentDiscount) || 70,
          clientDiscountPercent: Number(clientDiscount) || 80,
          directSaleMessageTemplate: msgTemplate,
          smsMessageTemplate: smsTemplate,
          whatsappMessageTemplate: whatsappTemplate,
          pdfHeaderTitle,
          pdfHeaderSubtitle,
          pdfFooterText,
          appDescription: appDescription.trim(),
        });
      } finally {
        setSavingSettings(false);
      }
    };

    return (
      <SubScreenShell
        title="الإعدادات وحول التطبيق"
        subtitle={SUPER_ADMIN_CONFIG.developerCredit}
        onBack={onBack}
      >
        <div className="space-y-4">
          {/* Device & Security Preferences */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-4 shadow-md space-y-3">
            <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-[#1A365D] text-[#FDE68A] flex items-center justify-center">
                <Settings className="w-4 h-4" />
              </span>
              تفضيلات الجهاز والأمان
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onToggleTheme}
                className="min-h-[46px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 flex items-center justify-between text-xs font-extrabold"
              >
                <span>مظهر التطبيق الحالي</span>
                <span className="flex items-center gap-1.5 text-[#1A365D] dark:text-[#FDE68A]">
                  {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  {isDark ? 'الوضع الليلي' : 'الوضع النهاري'}
                </span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (biometricActive) {
                    clearBiometricEnrollment();
                    setBiometricActive(false);
                    notifySuccess('تم إلغاء تفعيل البصمة على هذا الجهاز');
                  } else if (profile) {
                    const result = await enrollDeviceBiometric(
                      profile.uid,
                      profile.phone || profile.email,
                      profile.name
                    );
                    if (result.success) {
                      setBiometricActive(true);
                      notifySuccess(
                        result.mode === 'android_biometric'
                          ? 'تم تفعيل بصمة الإصبع والوجه عبر Android BiometricPrompt بنجاح ✅'
                          : result.mode === 'webauthn'
                            ? 'تم تفعيل الدخول بالبصمة والوجه بنجاح ✅'
                            : 'تم تفعيل الدخول السريع والآمن لهذا الجهاز بنجاح ✅'
                      );
                    }
                  }
                }}
                className={`min-h-[46px] rounded-xl border-2 px-3.5 flex items-center justify-between text-xs font-extrabold transition-colors ${
                  biometricActive
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Fingerprint className="w-4 h-4 text-[#D4AF37]" />
                  الدخول بالبصمة / الوجه
                </span>
                <span
                  className={
                    biometricActive
                      ? 'text-emerald-600 dark:text-emerald-400 font-extrabold'
                      : 'text-[#1A365D] dark:text-[#FDE68A]'
                  }
                >
                  {biometricActive ? 'مُفعّل ✅' : 'تفعيل الآن'}
                </span>
              </button>
            </div>
          </div>

          {/* About App Card */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-4 shadow-md">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-full bg-white p-1 border-2 border-[#D4AF37] shrink-0 shadow overflow-hidden">
                <img
                  src={TAIBAH_ASSETS.logo}
                  alt="شعار شبكة طيبة نت"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>حول تطبيق كروت طيبة نت (TAIBAH NET)</span>
                </h2>
                <p className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
                  {appDescription}
                </p>
              </div>
            </div>
          </div>

          {/* Super Admin Exclusive Global Cloud Settings (Strictly Hidden from Agents & Clients) */}
          {isAdmin && (
            <form onSubmit={handleSaveSettings} className="space-y-4">
              {/* 1. News Ticker Controls */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-500 text-[#0F172A] flex items-center justify-center">
                      <Newspaper className="w-4 h-4" />
                    </span>
                    إعدادات شريط الأخبار المتحرك
                  </h2>
                  <label className="flex items-center gap-2 text-xs font-extrabold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newsTickerEnabled}
                      onChange={(e) => setNewsTickerEnabled(e.target.checked)}
                      className="w-4 h-4 accent-[#1A365D]"
                    />
                    <span>{newsTickerEnabled ? 'مُفعّل' : 'مُعطّل'}</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1">نص الشريط الإخباري</label>
                  <textarea
                    rows={2}
                    value={newsTicker}
                    onChange={(e) => setNewsTicker(e.target.value)}
                    className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1">
                    سرعة حركة الشريط (بالثواني — الأقل أسرع: {newsTickerSpeed} ثانية)
                  </label>
                  <input
                    type="range"
                    min={8}
                    max={60}
                    value={Number(newsTickerSpeed) || 22}
                    onChange={(e) => setNewsTickerSpeed(e.target.value)}
                    className="w-full accent-[#D4AF37]"
                  />
                </div>
              </div>

              {/* 2. Hero Slider Controls */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                      <Sliders className="w-4 h-4" />
                    </span>
                    إعدادات السلايدر الإعلاني (الشرائح المتحركة)
                  </h2>
                  <label className="flex items-center gap-2 text-xs font-extrabold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sliderEnabled}
                      onChange={(e) => setSliderEnabled(e.target.checked)}
                      className="w-4 h-4 accent-[#1A365D]"
                    />
                    <span>{sliderEnabled ? 'إظهار السلايدر' : 'إخفاء السلايدر'}</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1">
                    مدة عرض كل شريحة (ثانية)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={30}
                    value={sliderSpeed}
                    onChange={(e) => setSliderSpeed(e.target.value)}
                    className="w-full sm:w-44 min-h-[42px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div className="space-y-2.5">
                  {sliderSlides.map((slide, idx) => (
                    <div
                      key={slide.id || idx}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                          الشريحة رقم {idx + 1}
                        </span>
                        {sliderSlides.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSlide(idx)}
                            className="px-2 py-1 rounded-lg bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[11px] font-extrabold flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> حذف
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={slide.title}
                          onChange={(e) => handleSlideChange(idx, 'title', e.target.value)}
                          placeholder="عنوان الشريحة"
                          className="min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-bold"
                        />
                        <input
                          type="text"
                          value={slide.subtitle}
                          onChange={(e) => handleSlideChange(idx, 'subtitle', e.target.value)}
                          placeholder="النص الفرعي"
                          className="min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-bold"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={slide.image.startsWith('data:') ? 'صورة مرفوعة من الجهاز ✅' : slide.image}
                          onChange={(e) => handleSlideChange(idx, 'image', e.target.value)}
                          placeholder="رابط الصورة أو ارفع صورة..."
                          className="flex-1 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-bold"
                        />
                        <label className="min-h-[38px] px-3 rounded-lg bg-[#1A365D] text-[#FDE68A] text-[11px] font-extrabold flex items-center gap-1 cursor-pointer shrink-0">
                          <ImagePlus className="w-3.5 h-3.5" />
                          <span>رفع صورة</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              void handleSlideImageUpload(idx, e.target.files?.[0]);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  ))}

                  {sliderSlides.length < 6 && (
                    <button
                      type="button"
                      onClick={handleAddSlide}
                      className="w-full min-h-[40px] rounded-xl border-2 border-dashed border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة شريحة إعلانية جديدة</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 3. Custom SMS, WhatsApp & PDF Branding Templates */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-4 shadow-md space-y-3">
                <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                    <MessageSquare className="w-4 h-4" />
                  </span>
                  تخصيص صيغ الرسائل (SMS / واتساب) وترويسة PDF
                </h2>
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  المتغيرات المتاحة: <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">{'{package}'}</code> اسم الباقة •{' '}
                  <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">{'{card}'}</code> رقم الكرت
                </p>

                <div>
                  <label className="block text-xs font-extrabold mb-1">صيغة رسالة SMS (تعمل أوفلاين وأونلاين)</label>
                  <textarea
                    rows={3}
                    value={smsTemplate}
                    onChange={(e) => setSmsTemplate(e.target.value)}
                    className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1">صيغة رسالة واتساب</label>
                  <textarea
                    rows={3}
                    value={whatsappTemplate}
                    onChange={(e) => setWhatsappTemplate(e.target.value)}
                    className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="text-xs font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-1.5">
                    <FileText className="w-4 h-4" />
                    تخصيص ترويسة وتذييل ملفات PDF والصور HD
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-extrabold mb-1">العنوان الرئيسي في الترويسة</label>
                      <input
                        type="text"
                        value={pdfHeaderTitle}
                        onChange={(e) => setPdfHeaderTitle(e.target.value)}
                        className="w-full min-h-[40px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-extrabold mb-1">العنوان الفرعي في الترويسة</label>
                      <input
                        type="text"
                        value={pdfHeaderSubtitle}
                        onChange={(e) => setPdfHeaderSubtitle(e.target.value)}
                        className="w-full min-h-[40px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold mb-1">نص التذييل أسفل التقرير / الفاتورة</label>
                    <input
                      type="text"
                      value={pdfFooterText}
                      onChange={(e) => setPdfFooterText(e.target.value)}
                      className="w-full min-h-[40px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* 4. Pricing, Threshold & General Admin Config */}
              <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-4 shadow-md space-y-3.5">
                <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-[#1A365D] text-[#FDE68A] flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4" />
                  </span>
                  إعدادات التسعير والمخزون العامة
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-extrabold mb-1">حد تنبيه المخزون المنخفض</label>
                    <input
                      type="number"
                      min={0}
                      value={lowStockThreshold}
                      onChange={(e) => setLowStockThreshold(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold mb-1">نسبة تسعير الوكيل (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={agentDiscount}
                      onChange={(e) => setAgentDiscount(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold mb-1">نسبة تسعير العميل (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={clientDiscount}
                      onChange={(e) => setClientDiscount(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1">
                    وصف التطبيق (يظهر في الإعدادات ومشاركة التطبيق)
                  </label>
                  <textarea
                    rows={2}
                    value={appDescription}
                    onChange={(e) => setAppDescription(e.target.value)}
                    className="w-full rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full min-h-[48px] royal-btn-3d text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4 text-[#FDE68A]" />
                  <span>{savingSettings ? 'جاري الحفظ السحابي...' : 'حفظ جميع الإعدادات وتعميمها فوراً'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </SubScreenShell>
    );
  }

  // =========================================================================
  // AUDIT LOG (Super Admin Only)
  // =========================================================================
  if (route === 'audit_logs') {
    const filteredLogs = auditLogs.filter(
      (l) =>
        !auditSearch.trim() ||
        l.action.includes(auditSearch.trim()) ||
        l.details.includes(auditSearch.trim()) ||
        l.actorName.includes(auditSearch.trim())
    );
    return (
      <SubScreenShell
        title="سجل العمليات الرقابي (Audit Log)"
        subtitle="توثيق سحابي غير قابل للتعديل لكافة الحركات"
        onBack={onBack}
      >
        <div className="relative mb-4">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            placeholder="بحث في سجل العمليات..."
            className="w-full min-h-[44px] rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pr-10 pl-3 text-sm font-bold focus:border-[#D4AF37] focus:outline-none"
          />
        </div>

        {filteredLogs.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/50 p-8 text-center">
            <FileClock className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
            <p className="text-sm font-extrabold">سجل العمليات فارغ حالياً (0)</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                    {log.action}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {log.actorName} • {formatDateTimeAr(log.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{log.details}</p>
              </div>
            ))}

            {hasMoreAuditLogs && (
              <button
                type="button"
                onClick={loadMoreAuditLogs}
                className="w-full min-h-[44px] rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold shadow-sm hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors"
              >
                تحميل المزيد من سجلات العمليات...
              </button>
            )}
          </div>
        )}
      </SubScreenShell>
    );
  }

  // =========================================================================
  // CLOUD BACKUP SCREEN (Strictly Isolated Stats per Account)
  // =========================================================================
  return (
    <SubScreenShell
      title="النسخ الاحتياطي السحابي"
      subtitle="تصدير فوري لبيانات حسابك بصيغة JSON"
      onBack={onBack}
    >
      <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-6 text-center shadow-lg">
        <div className="w-14 h-14 rounded-2xl bg-[#1A365D] text-[#FDE68A] flex items-center justify-center mx-auto mb-3 shadow-md">
          <DatabaseBackup className="w-7 h-7" />
        </div>
        <h2 className="text-base font-extrabold">النسخة الاحتياطية السحابية الفورية</h2>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed max-w-md mx-auto">
          تُحفظ بياناتك لحظياً على خوادم Firebase Firestore السحابية، ويمكنك تنزيل نسخة احتياطية محلية بصيغة JSON في أي وقت.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-2.5 border border-slate-200 dark:border-slate-700">
            <div className="text-lg font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
              {formatCount(packages.length || EXCLUSIVE_PACKAGES.length, hideNumbers)}
            </div>
            <div className="text-[11px] font-bold text-slate-500">الباقات</div>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-2.5 border border-slate-200 dark:border-slate-700">
            <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatCount(totalAvailableCards, hideNumbers)}
            </div>
            <div className="text-[11px] font-bold text-slate-500">الكروت المتاحة</div>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-2.5 border border-slate-200 dark:border-slate-700">
            <div className="text-lg font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">
              {formatCount(isAdmin || isAgent ? managedUsers.length : sales.length, hideNumbers)}
            </div>
            <div className="text-[11px] font-bold text-slate-500">
              {isAdmin || isAgent ? 'الحسابات' : 'عمليات البيع'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={exportCloudBackup}
          className="mt-5 w-full min-h-[48px] gold-btn-3d text-[#0F172A] font-extrabold text-sm rounded-xl flex items-center justify-center gap-2"
        >
          <DatabaseBackup className="w-4 h-4" />
          <span>تنزيل نسخة احتياطية الآن (JSON)</span>
        </button>
      </div>
    </SubScreenShell>
  );
};
