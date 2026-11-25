import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellRing,
  CheckCheck,
  DatabaseBackup,
  DownloadCloud,
  FileClock,
  FileText,
  Fingerprint,
  ImagePlus,
  KeyRound,
  Loader2,
  MessageSquare,
  Moon,
  Newspaper,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sliders,
  Smartphone,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useFeedback } from '../lib/feedback';
import {
  clearBiometricEnrollment,
  enrollDeviceBiometric,
  getBiometricMethodStatus,
  getMemorySessionCredentials,
  resetBiometricPromptLock,
  type BiometricMethod,
} from '../lib/biometric';
import {
  findVaultAccountByIdentifier,
  setVaultAccountBiometricEnabled,
} from '../lib/localAuthVault';
import { useDebounce } from '../hooks/useDebounce';
import { getInstalledAppVersion } from '../services/updaterService';
import { DirectSaleScreen } from './DirectSaleScreen';
import { ErrorBoundary } from './ErrorBoundary';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_HERO_SLIDES,
  EXCLUSIVE_PACKAGES,
  formatCount,
  formatDateTimeAr,
  resolveDirectSaleTemplate,
  SUPER_ADMIN_CONFIG,
  TAIBAH_ASSETS,
  type AppRoute,
  type HeroSlideConfig,
} from '../types/taibah';

// Code Splitting — secondary sub-screens lazy-loaded & preloaded silently in background
const loadSalesList = () =>
  import('./SalesListScreen').then((m) => ({ default: m.SalesListScreen }));
const loadWholesaleCards = () =>
  import('./WholesaleCardsScreen').then((m) => ({ default: m.WholesaleCardsScreen }));
const loadCustomersLedger = () =>
  import('./CustomersLedgerScreen').then((m) => ({ default: m.CustomersLedgerScreen }));
const loadPackagesImport = () =>
  import('./PackagesImportScreen').then((m) => ({ default: m.PackagesImportScreen }));
const loadTopupRequests = () =>
  import('./TopupRequestsScreen').then((m) => ({ default: m.TopupRequestsScreen }));
const loadAgentsManagement = () =>
  import('./AgentsManagementScreen').then((m) => ({ default: m.AgentsManagementScreen }));
const loadReportsCenter = () =>
  import('./ReportsCenterScreen').then((m) => ({ default: m.ReportsCenterScreen }));
const loadRecallCardsPanel = () =>
  import('./RecallCardsPanel').then((m) => ({ default: m.RecallCardsPanel }));

const SalesListScreen = lazy(loadSalesList);
const WholesaleCardsScreen = lazy(loadWholesaleCards);
const CustomersLedgerScreen = lazy(loadCustomersLedger);
const PackagesImportScreen = lazy(loadPackagesImport);
const TopupRequestsScreen = lazy(loadTopupRequests);
const AgentsManagementScreen = lazy(loadAgentsManagement);
const ReportsCenterScreen = lazy(loadReportsCenter);
const RecallCardsPanel = lazy(loadRecallCardsPanel);

let preloadedOnce = false;
export function preloadCoreSubScreens(): void {
  if (preloadedOnce) return;
  preloadedOnce = true;
  void Promise.allSettled([
    loadSalesList(),
    loadWholesaleCards(),
    loadCustomersLedger(),
    loadTopupRequests(),
    loadReportsCenter(),
  ]);
}

const LazyFallback: React.FC = () => (
  <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#1A365D] dark:text-[#FDE68A]">
    <Loader2 className="w-6 h-6 animate-spin" />
    <span className="text-xs font-extrabold">جاري الفتح...</span>
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
    className={`taibah-app-frame ${
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
          <div className="w-full h-full rounded-full bg-[#061124] flex items-center justify-center overflow-hidden p-0.5">
            <img
              src={TAIBAH_ASSETS.logo}
              alt="شعار طيبة نت"
              referrerPolicy="no-referrer"
              className="w-full h-full rounded-full object-contain"
            />
          </div>
        </div>
      </div>
    </header>

    <main
      className={
        fixedViewport
          ? 'flex-1 min-h-0 w-full max-w-5xl mx-auto px-3.5 py-2.5 safe-x overflow-hidden flex flex-col'
          : 'flex-1 w-full max-w-5xl mx-auto px-3.5 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+28px)] sm:px-5 sm:pt-4 safe-x'
      }
    >
      <ErrorBoundary resetKey={title} onReturnHome={onBack}>
        {children}
      </ErrorBoundary>
    </main>

    <footer className="shrink-0 bg-[#0F172A] border-t-2 border-[#D4AF37]/80 pt-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+8px)] text-center">
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
  onManualCheckUpdate?: () => void | Promise<void>;
}

export const ActiveSubScreen: React.FC<ActiveSubScreenProps> = ({
  route,
  onBack,
  onNavigate,
  isDark,
  onToggleTheme,
  hideNumbers,
  onManualCheckUpdate,
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
    restoreDeletedAgentsAndClients,
    resetAppData,
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
  const [msgTemplate, setMsgTemplate] = useState(
    resolveDirectSaleTemplate(appSettings.directSaleMessageTemplate)
  );
  const [smsTemplate, setSmsTemplate] = useState(
    resolveDirectSaleTemplate(appSettings.smsMessageTemplate)
  );
  const [whatsappTemplate, setWhatsappTemplate] = useState(
    resolveDirectSaleTemplate(appSettings.whatsappMessageTemplate)
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
  const [pendingBioMethod, setPendingBioMethod] = useState<BiometricMethod | null>(null);
  const [settingsBioPass, setSettingsBioPass] = useState('');
  const [enrollingSettingsBio, setEnrollingSettingsBio] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Super Admin Only: App Data Reset & Account Recovery States
  const [resetScope, setResetScope] = useState<'sales_only' | 'full_reset' | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPhrase, setResetConfirmPhrase] = useState('');
  const [resettingData, setResettingData] = useState(false);
  const [resetProgressText, setResetProgressText] = useState('');
  const [resetError, setResetError] = useState('');
  const [restoringAccounts, setRestoringAccounts] = useState(false);
  const [restoreProgressText, setRestoreProgressText] = useState('');
  const [restoreResult, setRestoreResult] = useState<{
    ok: boolean;
    summary: string;
    sourcesSummary?: string;
  } | null>(null);

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
    setMsgTemplate(resolveDirectSaleTemplate(appSettings.directSaleMessageTemplate));
    setSmsTemplate(resolveDirectSaleTemplate(appSettings.smsMessageTemplate));
    setWhatsappTemplate(resolveDirectSaleTemplate(appSettings.whatsappMessageTemplate));
    setPdfHeaderTitle(appSettings.pdfHeaderTitle || DEFAULT_APP_SETTINGS.pdfHeaderTitle || '');
    setPdfHeaderSubtitle(
      appSettings.pdfHeaderSubtitle || DEFAULT_APP_SETTINGS.pdfHeaderSubtitle || ''
    );
    setPdfFooterText(appSettings.pdfFooterText || DEFAULT_APP_SETTINGS.pdfFooterText || '');
    setAppDescription(appSettings.appDescription || DEFAULT_APP_SETTINGS.appDescription || '');
  }, [appSettings]);

  const [bioStatus, setBioStatus] = useState(() => getBiometricMethodStatus());
  const [auditSearch, setAuditSearch] = useState('');
  const debouncedAuditSearch = useDebounce(auditSearch, 180);
  const [auditVisibleCount, setAuditVisibleCount] = useState(50);

  useEffect(() => {
    resetBiometricPromptLock();
    return () => {
      resetBiometricPromptLock();
    };
  }, [route]);

  useEffect(() => {
    setAuditVisibleCount(50);
  }, [debouncedAuditSearch]);

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
        <DirectSaleScreen hideNumbers={hideNumbers} />
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
        <div className="space-y-3.5 pb-[calc(env(safe-area-inset-bottom,0px)+96px)]">
          {/* Device & Security Preferences */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/70 p-3.5 shadow-md space-y-2.5">
            <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-[#1A365D] text-[#FDE68A] flex items-center justify-center shrink-0">
                <Settings className="w-3.5 h-3.5" />
              </span>
              تفضيلات الجهاز والأمان
            </h2>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={onToggleTheme}
                className="min-h-[46px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3.5 flex items-center justify-between text-xs font-extrabold shadow-xs"
              >
                <span>مظهر التطبيق الحالي</span>
                <span className="flex items-center gap-1.5 text-[#1A365D] dark:text-[#FDE68A]">
                  {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  {isDark ? 'الوضع الليلي' : 'الوضع النهاري'}
                </span>
              </button>

              {/* ONE Unified Native Android BiometricPrompt Toggle (Fingerprint + Face + Device PIN) */}
              <button
                type="button"
                disabled={enrollingSettingsBio}
                onClick={async () => {
                  if (enrollingSettingsBio || !profile) return;
                  if (bioStatus.hasAnyEnabled) {
                    clearBiometricEnrollment();
                    setVaultAccountBiometricEnabled(profile.uid || profile.email || profile.phone, false);
                    setBioStatus(getBiometricMethodStatus());
                    notifySuccess('تم إيقاف الدخول الحيوي (البصمة / الوجه / رمز الجهاز) على هذا الهاتف');
                    return;
                  }
                  const mem = getMemorySessionCredentials();
                  const hasLocalVaultAccount = Boolean(
                    findVaultAccountByIdentifier(profile.email) ||
                      findVaultAccountByIdentifier(profile.phone) ||
                      findVaultAccountByIdentifier(profile.uid)
                  );
                  if (!mem?.password && !bioStatus.hasVault && !hasLocalVaultAccount) {
                    setSettingsBioPass('');
                    setPendingBioMethod('unified');
                    return;
                  }
                  setEnrollingSettingsBio(true);
                  const safetyTimer = window.setTimeout(() => {
                    setEnrollingSettingsBio(false);
                  }, 8500);
                  try {
                    const result = await enrollDeviceBiometric(
                      profile.uid,
                      profile.phone || profile.email,
                      profile.name,
                      {
                        method: 'unified',
                        authEmail: mem?.email || profile.email,
                        password: mem?.password,
                      }
                    );
                    setBioStatus(getBiometricMethodStatus());
                    if (result.success) {
                      setVaultAccountBiometricEnabled(profile.uid || profile.email || profile.phone, true);
                      notifySuccess('تم تفعيل الدخول الحيوي الموحد (البصمة / الوجه / رمز الجهاز) بنجاح ✅');
                    } else if (result.errorMessage) {
                      notifyError('تعذر تفعيل الدخول الحيوي', result.errorMessage);
                    }
                  } catch {
                    notifyError(
                      'تعذر تفعيل الدخول الحيوي',
                      'حدث خطأ أثناء فتح نافذة التحقق الحيوي — حاول مرة أخرى.'
                    );
                  } finally {
                    window.clearTimeout(safetyTimer);
                    setEnrollingSettingsBio(false);
                  }
                }}
                className={`min-h-[52px] rounded-xl border-2 px-3 py-2 flex items-center justify-between gap-2 text-xs font-extrabold transition-colors disabled:opacity-65 ${
                  bioStatus.hasAnyEnabled
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                    : 'border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0 flex-1 text-right">
                  <Fingerprint className="w-4 h-4 text-[#D4AF37] shrink-0" />
                  <span className="leading-snug break-words">
                    الدخول الحيوي الموحد (البصمة / الوجه / رمز الجهاز)
                  </span>
                </span>
                <span
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-extrabold whitespace-nowrap ${
                    bioStatus.hasAnyEnabled
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37]'
                  }`}
                >
                  {enrollingSettingsBio
                    ? 'جاري التحقق...'
                    : bioStatus.hasAnyEnabled
                      ? 'مُفعّل ✅'
                      : 'تفعيل'}
                </span>
              </button>
            </div>
          </div>

          {/* Super Admin EXCLUSIVE: Recall Unsold Cards From Agent / Client */}
          {isAdmin && (
            <Suspense fallback={<LazyFallback />}>
              <RecallCardsPanel />
            </Suspense>
          )}

          {/* App Updates Section (Visible to ALL users: Admin, Agent, Client) */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-3.5 shadow-md space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A] flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-[#1A365D] text-[#FDE68A] border border-[#D4AF37] flex items-center justify-center shrink-0">
                  <DownloadCloud className="w-4 h-4" />
                </span>
                تحديثات التطبيق
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-[#D4AF37] text-[11px] font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
                الإصدار الحالي: v{getInstalledAppVersion()}
              </span>
            </div>
            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 leading-relaxed">
              تحديث خفيف وفوري (OTA) يحمّل آخر التحسينات خلال ثوانٍ دون فقدان أي بيانات أو تسجيل خروج.
            </p>
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={async () => {
                if (checkingUpdate || !onManualCheckUpdate) return;
                setCheckingUpdate(true);
                const updateGuard = window.setTimeout(() => setCheckingUpdate(false), 12000);
                try {
                  await onManualCheckUpdate();
                } finally {
                  window.clearTimeout(updateGuard);
                  setCheckingUpdate(false);
                }
              }}
              className="w-full min-h-[44px] rounded-xl bg-gradient-to-b from-[#1E3A8A] via-[#1A365D] to-[#0F172A] border-2 border-[#D4AF37] text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow active:scale-[0.99] transition-transform disabled:opacity-70"
            >
              {checkingUpdate ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#FDE68A]" />
              ) : (
                <DownloadCloud className="w-4 h-4 text-[#FDE68A]" />
              )}
              <span>
                {checkingUpdate ? 'جاري فحص التحديثات...' : 'التحقق من وجود تحديث خفيف'}
              </span>
            </button>
          </div>

          {pendingBioMethod && profile && (
            <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4 safe-top safe-bottom">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!settingsBioPass) return;
                  setEnrollingSettingsBio(true);
                  const safetyTimer = window.setTimeout(() => {
                    setEnrollingSettingsBio(false);
                  }, 8500);
                  try {
                    const result = await enrollDeviceBiometric(
                      profile.uid,
                      profile.phone || profile.email,
                      profile.name,
                      {
                        method: 'unified',
                        authEmail: profile.email,
                        password: settingsBioPass,
                      }
                    );
                    setBioStatus(getBiometricMethodStatus());
                    if (result.success) {
                      setPendingBioMethod(null);
                      setSettingsBioPass('');
                      notifySuccess('تم تفعيل الدخول الحيوي الموحد بنجاح ✅');
                    } else {
                      notifyError(
                        'تعذر تفعيل الدخول الحيوي',
                        result.errorMessage || 'تأكد من إعداد البصمة أو الوجه في أمان الهاتف.'
                      );
                    }
                  } catch {
                    notifyError(
                      'تعذر تفعيل الدخول الحيوي',
                      'حدث خطأ أثناء تفعيل التحقق الحيوي — حاول مجدداً.'
                    );
                  } finally {
                    window.clearTimeout(safetyTimer);
                    setEnrollingSettingsBio(false);
                  }
                }}
                className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-5 shadow-2xl space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#1A365D] dark:text-[#FDE68A]">
                    <KeyRound className="w-5 h-5" />
                    <h3 className="text-sm font-extrabold">
                      تفعيل الدخول الحيوي (البصمة / الوجه / رمز الجهاز)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingBioMethod(null)}
                    className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300 leading-relaxed">
                  أدخل كلمة المرور لمرة واحدة لتشفير بيانات حسابك داخل خزنة الهاتف الآمنة (Keystore).
                </p>
                <input
                  type="password"
                  value={settingsBioPass}
                  onChange={(e) => setSettingsBioPass(e.target.value)}
                  placeholder="كلمة مرور الحساب..."
                  className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold text-slate-900 dark:text-white focus:border-[#D4AF37] focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={enrollingSettingsBio}
                  className="w-full min-h-[44px] royal-btn-3d border-2 border-[#D4AF37] text-white font-extrabold text-xs rounded-xl"
                >
                  {enrollingSettingsBio ? 'جاري التحقق والتشفير...' : 'التحقق وتفعيل الدخول الحيوي'}
                </button>
              </form>
            </div>
          )}

          {/* About App Card */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] p-4 shadow-md">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-full p-0.5 bg-gradient-to-tr from-[#B4860B] via-[#FDE68A] to-[#D4AF37] shrink-0 shadow">
                <div className="w-full h-full rounded-full bg-[#061124] p-1 flex items-center justify-center overflow-hidden">
                  <img
                    src={TAIBAH_ASSETS.logo}
                    alt="شعار شبكة طيبة نت"
                    className="w-full h-full rounded-full object-contain"
                  />
                </div>
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
                    className="w-full rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold shadow-xs focus:border-[#D4AF37] focus:outline-none"
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
                    inputMode="numeric"
                    min={2}
                    max={30}
                    value={sliderSpeed === '0' ? '' : sliderSpeed}
                    placeholder="5"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setSliderSpeed(e.target.value)}
                    className="w-full sm:w-44 min-h-[42px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div className="space-y-2.5">
                  {sliderSlides.map((slide, idx) => (
                    <div
                      key={slide.id || idx}
                      className="rounded-xl border-2 border-[#D4AF37]/65 dark:border-[#D4AF37]/50 bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2 shadow-sm"
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
                          className="min-h-[38px] rounded-lg border-2 border-[#1A365D]/60 dark:border-[#60A5FA]/60 bg-white dark:bg-slate-900 px-2.5 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                        />
                        <input
                          type="text"
                          value={slide.subtitle}
                          onChange={(e) => handleSlideChange(idx, 'subtitle', e.target.value)}
                          placeholder="النص الفرعي"
                          className="min-h-[38px] rounded-lg border-2 border-[#1A365D]/60 dark:border-[#60A5FA]/60 bg-white dark:bg-slate-900 px-2.5 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={slide.image.startsWith('data:') ? 'صورة مرفوعة من الجهاز ✅' : slide.image}
                          onChange={(e) => handleSlideChange(idx, 'image', e.target.value)}
                          placeholder="رابط الصورة أو ارفع صورة..."
                          className="flex-1 min-h-[38px] rounded-lg border-2 border-[#1A365D]/60 dark:border-[#60A5FA]/60 bg-white dark:bg-slate-900 px-2.5 text-xs font-bold focus:border-[#D4AF37] focus:outline-none"
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
                    className="w-full rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1">صيغة رسالة واتساب</label>
                  <textarea
                    rows={3}
                    value={whatsappTemplate}
                    onChange={(e) => setWhatsappTemplate(e.target.value)}
                    className="w-full rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div className="pt-2 border-t-2 border-[#D4AF37]/40 space-y-2.5">
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
                        className="w-full min-h-[40px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-extrabold mb-1">العنوان الفرعي في الترويسة</label>
                      <input
                        type="text"
                        value={pdfHeaderSubtitle}
                        onChange={(e) => setPdfHeaderSubtitle(e.target.value)}
                        className="w-full min-h-[40px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-extrabold mb-1">نص التذييل أسفل التقرير / الفاتورة</label>
                    <input
                      type="text"
                      value={pdfFooterText}
                      onChange={(e) => setPdfFooterText(e.target.value)}
                      className="w-full min-h-[40px] rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
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
                      inputMode="numeric"
                      min={0}
                      value={lowStockThreshold === '0' ? '' : lowStockThreshold}
                      placeholder="0"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setLowStockThreshold(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold mb-1">نسبة تسعير الوكيل (%)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      value={agentDiscount === '0' ? '' : agentDiscount}
                      placeholder="70"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setAgentDiscount(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold mb-1">نسبة تسعير العميل (%)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      value={clientDiscount === '0' ? '' : clientDiscount}
                      placeholder="80"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setClientDiscount(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border-2 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-bold tabular-nums focus:border-[#D4AF37] focus:outline-none"
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
                    className="w-full rounded-xl border-2 border-[#1A365D]/65 dark:border-[#60A5FA]/65 bg-slate-50 dark:bg-slate-800 p-3 text-xs font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full min-h-[46px] royal-btn-3d text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4 text-[#FDE68A]" />
                  <span>{savingSettings ? 'جاري الحفظ السحابي...' : 'حفظ جميع الإعدادات وتعميمها فوراً'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Super Admin Exclusive: Recover Deleted Agents & Clients Tool */}
          {isAdmin && (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-emerald-600/85 p-3.5 shadow-md space-y-2.5">
              <div className="flex items-start gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <RotateCcw className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                    استرجاع الوكلاء والعملاء المحذوفين
                  </h2>
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                    فحص واسترجاع جميع حسابات الوكلاء والعملاء تلقائياً من النسخ الاحتياطية السحابية والمحلية وسجل العمليات والفواتير التاريخية وإعادة ربطها في السحابة (users و clients).
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={restoringAccounts}
                onClick={async () => {
                  if (!isAdmin || restoringAccounts) return;
                  setRestoringAccounts(true);
                  setRestoreResult(null);
                  setRestoreProgressText('جاري فحص النسخ الاحتياطية والسجلات التاريخية...');
                  try {
                    const res = await restoreDeletedAgentsAndClients((stage) => {
                      setRestoreProgressText(stage);
                    });
                    setRestoreResult({
                      ok: res.ok,
                      summary: res.summary,
                      sourcesSummary: res.sourcesSummary,
                    });
                  } finally {
                    setRestoringAccounts(false);
                    setRestoreProgressText('');
                  }
                }}
                className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-extrabold flex items-center justify-center gap-2 px-3 shadow transition-colors"
              >
                {restoringAccounts ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>جاري البحث والاسترجاع...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4 shrink-0" />
                    <span>استرجاع الوكلاء والعملاء المحذوفين</span>
                  </>
                )}
              </button>

              {restoringAccounts && restoreProgressText && (
                <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 text-center">
                  {restoreProgressText}
                </p>
              )}

              {restoreResult && (
                <div
                  className={`rounded-xl px-3 py-2 text-[11px] font-bold flex items-start justify-between gap-2 border ${
                    restoreResult.ok
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200'
                  }`}
                >
                  <div className="space-y-0.5 leading-relaxed">
                    <p>{restoreResult.summary}</p>
                    {restoreResult.sourcesSummary && (
                      <p className="text-[10px] opacity-85">المصادر: {restoreResult.sourcesSummary}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRestoreResult(null)}
                    className="p-0.5 opacity-70 hover:opacity-100 shrink-0"
                    aria-label="إغلاق"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Super Admin Exclusive: Safe App Data Reset Box (STRICTLY HIDDEN & BLOCKED FOR AGENTS & CLIENTS) */}
          {isAdmin && (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#DC2626]/85 p-3.5 shadow-md space-y-3">
              <div className="flex items-start gap-2.5">
                <span className="w-7 h-7 rounded-lg bg-[#DC2626] text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-extrabold text-[#DC2626] dark:text-red-400">
                    تصفير بيانات التطبيق بالكامل وحذفها
                  </h2>
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                    يتم أولاً حفظ نسخة احتياطية تلقائية (auto_backup) في السحابة والهاتف، ثم تصفير الكروت والمبيعات والفواتير والأرصدة إلى (0) مع الإبقاء الكامل على المدير العام وجميع الوكلاء والعملاء وهيكل الباقات الثماني.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setResetScope('full_reset');
                    setResetPassword('');
                    setResetConfirmPhrase('');
                    setResetProgressText('');
                    setResetError('');
                  }}
                  className="min-h-[48px] rounded-xl border-2 border-[#DC2626] bg-red-50 dark:bg-red-950/35 hover:bg-red-100 dark:hover:bg-red-950/55 px-3 py-2 text-right transition-colors active:scale-[0.99]"
                >
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#DC2626] dark:text-red-300">
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>تصفير بيانات التطبيق بالكامل وحذفها</span>
                  </div>
                  <p className="text-[10.5px] font-bold text-red-700/90 dark:text-red-300/90 mt-0.5">
                    أخذ نسخة تلقائية ثم تصفير الكروت والمبيعات والفواتير والدفتر والأرصدة إلى (0) مع بقاء جميع حسابات الإدارة والوكلاء والعملاء.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setResetScope('sales_only');
                    setResetPassword('');
                    setResetConfirmPhrase('');
                    setResetProgressText('');
                    setResetError('');
                  }}
                  className="min-h-[48px] rounded-xl border-2 border-amber-500/90 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 px-3 py-2 text-right transition-colors active:scale-[0.99]"
                >
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-900 dark:text-amber-200">
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>تصفير المبيعات والتقارير فقط</span>
                  </div>
                  <p className="text-[10.5px] font-bold text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                    أخذ نسخة تلقائية ثم حذف فواتير المبيعات وتصفير عداد المباع مع بقاء الكروت والوكلاء والعملاء.
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Super Admin Strict Security Confirmation Modal (Password + Word «تصفير») */}
          {isAdmin && resetScope && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 safe-top safe-bottom">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!isAdmin || resettingData) return;
                  if (resetPassword.trim().length < 6) {
                    setResetError('يرجى إدخال كلمة مرور المدير العام الصحيحة.');
                    return;
                  }
                  if (resetConfirmPhrase.trim() !== 'تصفير') {
                    setResetError('يرجى كتابة كلمة «تصفير» بدقة في حقل التأكيد النهائي.');
                    return;
                  }
                  setResetError('');
                  setResetProgressText('جاري بدء عملية التصفير...');
                  setResettingData(true);
                  try {
                    const res = await resetAppData(resetScope, resetPassword, (stage) => {
                      setResetProgressText(stage);
                    });
                    if (res.ok) {
                      if (resetScope !== 'full_reset') {
                        setResetScope(null);
                        setResetPassword('');
                        setResetConfirmPhrase('');
                        setResetProgressText('');
                      }
                    } else {
                      setResetError(res.error || 'تعذر تنفيذ عملية التصفير.');
                      setResetProgressText('');
                    }
                  } finally {
                    setResettingData(false);
                  }
                }}
                className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border-2 border-[#DC2626] p-4 sm:p-5 shadow-2xl space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[#DC2626] dark:text-red-400">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <h3 className="text-sm font-extrabold">
                      {resetScope === 'full_reset'
                        ? 'تأكيد تصفير بيانات التطبيق بالكامل'
                        : 'تأكيد تصفير المبيعات والتقارير فقط'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={resettingData}
                    onClick={() => setResetScope(null)}
                    className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900 p-2.5 text-[11.5px] font-bold text-red-800 dark:text-red-200 leading-relaxed">
                  {resetScope === 'full_reset'
                    ? 'تنبيه أمني: سيتم أولاً أخذ نسخة احتياطية تلقائية كاملة (auto_backup) في السحابة والهاتف، ثم حذف الكروت والمبيعات والفواتير والدفتر وطلبات التغذية والإشعارات وتصفير الأرصدة إلى (0)، مع الاحتفاظ الكامل بحساب المدير العام وجميع الوكلاء والعملاء المسجلين وهيكل الباقات الثماني.'
                    : 'تنبيه: سيتم أولاً أخذ نسخة احتياطية تلقائية (auto_backup)، ثم حذف فواتير المبيعات والتقارير وتصفير عداد المباع مع الإبقاء على الكروت المتاحة وحسابات الإدارة والوكلاء والعملاء.'}
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1 text-slate-800 dark:text-slate-200">
                    1. أدخل كلمة مرور المدير العام ({SUPER_ADMIN_CONFIG.name})
                  </label>
                  <input
                    type="password"
                    required
                    disabled={resettingData}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="كلمة مرور المدير العام..."
                    className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#DC2626] focus:outline-none"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold mb-1 text-slate-800 dark:text-slate-200">
                    2. اكتب كلمة <span className="text-[#DC2626] dark:text-red-400">«تصفير»</span> للتأكيد النهائي
                  </label>
                  <input
                    type="text"
                    required
                    disabled={resettingData}
                    value={resetConfirmPhrase}
                    onChange={(e) => setResetConfirmPhrase(e.target.value)}
                    placeholder="اكتب هنا: تصفير"
                    className="w-full min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-900 dark:text-white focus:border-[#DC2626] focus:outline-none"
                  />
                </div>

                {resettingData && resetProgressText && (
                  <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-400/80 px-3 py-2 text-xs font-extrabold text-amber-900 dark:text-amber-200">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>{resetProgressText}</span>
                  </div>
                )}

                {resetError && (
                  <p className="text-xs font-extrabold text-[#DC2626] dark:text-red-400 bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-900 rounded-xl px-3 py-2">
                    {resetError}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    disabled={resettingData}
                    onClick={() => setResetScope(null)}
                    className="min-h-[42px] rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-extrabold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={
                      resettingData ||
                      resetConfirmPhrase.trim() !== 'تصفير' ||
                      resetPassword.trim().length < 6
                    }
                    className="min-h-[42px] rounded-xl bg-[#DC2626] hover:bg-red-700 disabled:opacity-45 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md"
                  >
                    {resettingData ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>جاري التصفير...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>تأكيد التصفير النهائي</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </SubScreenShell>
    );
  }

  // =========================================================================
  // AUDIT LOG (Super Admin Only)
  // =========================================================================
  if (route === 'audit_logs') {
    const q = debouncedAuditSearch.trim().toLowerCase();
    const filteredLogs = (auditLogs || []).filter(
      (l) =>
        !q ||
        (l?.action || '').toLowerCase().includes(q) ||
        (l?.details || '').toLowerCase().includes(q) ||
        (l?.actorName || '').toLowerCase().includes(q)
    );
    const visibleLogs = filteredLogs.slice(0, auditVisibleCount);
    return (
      <SubScreenShell
        title="سجل العمليات الرقابي (Audit Log)"
        subtitle="توثيق سحابي غير قابل للتعديل لكافة الحركات"
        onBack={onBack}
      >
        <div className="relative mb-4">
          <Search className="w-4 h-4 text-[#1A365D] dark:text-[#FDE68A] absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            placeholder="بحث في سجل العمليات..."
            className="w-full min-h-[44px] rounded-xl border-2 border-[#1A365D]/70 dark:border-[#60A5FA]/70 bg-white dark:bg-slate-900 pr-10 pl-3 text-sm font-bold shadow-sm focus:border-[#D4AF37] focus:outline-none"
          />
        </div>

        {filteredLogs.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/75 p-8 text-center shadow-sm">
            <FileClock className="w-10 h-10 mx-auto text-[#D4AF37] mb-2" />
            <p className="text-sm font-extrabold">سجل العمليات فارغ حالياً (0)</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37]/60 dark:border-[#D4AF37]/50 hover:border-[#D4AF37] p-3.5 shadow-sm transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold text-[#1A365D] dark:text-[#FDE68A]">
                    {log.action}
                  </span>
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {log.actorName} • {formatDateTimeAr(log.createdAt)}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-1">{log.details}</p>
              </div>
            ))}

            {filteredLogs.length > auditVisibleCount && (
              <button
                type="button"
                onClick={() => setAuditVisibleCount((c) => c + 50)}
                className="w-full min-h-[44px] rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-[#D4AF37]/60 text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold shadow-sm"
              >
                عرض المزيد (50 سجل إضافي من أصل {formatCount(filteredLogs.length)})
              </button>
            )}

            {hasMoreAuditLogs && filteredLogs.length <= auditVisibleCount && (
              <button
                type="button"
                onClick={loadMoreAuditLogs}
                className="w-full min-h-[44px] rounded-2xl bg-white dark:bg-slate-900 border-2 border-[#D4AF37] text-[#1A365D] dark:text-[#FDE68A] text-xs font-extrabold shadow-sm hover:bg-amber-50 dark:hover:bg-slate-800 transition-colors"
              >
                تحميل المزيد من السحابة...
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
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-2.5 border-2 border-[#D4AF37]/70 shadow-sm">
            <div className="text-lg font-extrabold text-[#1A365D] dark:text-[#FDE68A] tabular-nums">
              {formatCount((packages || []).length || EXCLUSIVE_PACKAGES.length, hideNumbers)}
            </div>
            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">الباقات</div>
          </div>
          <div className="rounded-xl bg-emerald-50/70 dark:bg-slate-800 p-2.5 border-2 border-emerald-600/70 shadow-sm">
            <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {formatCount(totalAvailableCards ?? 0, hideNumbers)}
            </div>
            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">الكروت المتاحة</div>
          </div>
          <div className="rounded-xl bg-blue-50/70 dark:bg-slate-800 p-2.5 border-2 border-blue-600/70 shadow-sm">
            <div className="text-lg font-extrabold text-blue-700 dark:text-blue-400 tabular-nums">
              {formatCount(isAdmin || isAgent ? (managedUsers || []).length : (sales || []).length, hideNumbers)}
            </div>
            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
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
